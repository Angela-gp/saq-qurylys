from pathlib import Path


def test_import_accepts_fields_from_published_ashyq_schema(test_client):
    csv_text = (
        "object_id,object_location,builder_bin_hashed,builder_name,"
        "authorized_org_bin_hashed,authorized_org_name,object_address,"
        "date_start,date_end,permission_number,time_modif\n"
        "1,Астана,hashed-value,Строительная компания,,,"
        "г. Астана,2026-01-01,2026-12-31,PERMIT-1,2026-01-02\n"
    )
    response = test_client.post(
        "/api/import/ashyq",
        files={"file": ("ashyq-schema-check.csv", csv_text.encode("utf-8"), "text/csv")},
    )

    assert response.status_code == 201
    assert response.json()["uploaded_rows"] == 1
    assert response.json()["imported_objects"] == 1

    imported = test_client.get("/api/objects").json()[0]
    assert imported["name"] == "г. Астана"
    assert imported["address"] == "г. Астана"
    assert imported["developer"] == "Строительная компания"
    assert imported["is_demo"] is False
    assert imported["legal_basis_status"] == "not_checked"
    assert imported["score"]["score"] == 0
    assert imported["legal_check"]["status"] == "found"
    assert imported["legal_check"]["dataset_name"]
    assert imported["legal_check"]["source_url"].startswith("https://")

    audit = test_client.get(f"/api/objects/{imported['id']}/audit").json()
    assert audit[0]["details"]["source_id"] == "1"
    assert audit[0]["details"]["permission_number"] == "PERMIT-1"


def test_import_sample_deduplicates_and_discards_unmapped_personal_columns(test_client):
    sample = Path(__file__).resolve().parents[2] / "data" / "sample" / "ashyq-synthetic-sample.csv"
    content = sample.read_bytes()
    for _ in range(2):
        response = test_client.post(
            "/api/import/ashyq",
            files={"file": (sample.name, content, "text/csv")},
        )
        assert response.status_code == 201
    response = test_client.post(
        "/api/import/ashyq",
        files={
            "file": (
                "with-private-column.csv",
                "object_id,builder_name,object_address,signatory_fio\n"
                "PII-1,ТОО «Жасанды» ,Астана,Айгүл Құпияқызы\n".encode(),
                "text/csv",
            )
        },
    )
    assert response.status_code == 201
    obj = next(item for item in test_client.get("/api/objects").json() if item["name"] == "Астана")
    assert "Құпия" not in str(obj)
    assert test_client.get("/api/objects").json()[0]["legal_check"]["status"] == "found"
    assert response.json()["accepted"][0]["status"] == "accepted"


def test_import_does_not_publish_personal_name_from_developer_field(test_client):
    response = test_client.post(
        "/api/import/ashyq",
        files={
            "file": (
                "private-name.csv",
                "object_id,builder_name,object_address\nPII-2,Айгүл Құпияқызы,Тестовый объект\n".encode(),
                "text/csv",
            )
        },
    )
    assert response.status_code == 201
    obj = test_client.get("/api/objects").json()[0]
    assert obj["name"] == "Тестовый объект"
    assert obj["developer"] == "Индивидуальный предприниматель"
    assert "Құпия" not in str(obj)


def test_screenshot_upload_rejects_content_that_does_not_match_image_mime(test_client):
    publication = test_client.post(
        "/api/publications", json={"text": "обычный текст публикации для проверки"}
    ).json()
    response = test_client.post(
        f"/api/publications/{publication['publication_id']}/screenshot",
        files={"file": ("image.png", b"not an image", "image/png")},
    )
    assert response.status_code == 415
    assert response.json()["error_code"] == "invalid_image_content"


def test_not_found_in_loaded_dataset_never_creates_r1(test_client):
    object_response = test_client.post(
        "/api/objects",
        json={"name": "ЖК Жасанды", "developer": "ТОО «Мысал»", "address": "Тестовый адрес"},
    )
    assert object_response.status_code == 201
    test_client.post(
        "/api/import/ashyq",
        files={
            "file": (
                "loaded.csv",
                "object_id,builder_name,object_address,permission_number\n"
                "REG-1,ТОО «Басқа» ,Другой адрес,P-1\n".encode(),
                "text/csv",
            )
        },
    )
    object_id = object_response.json()["id"]
    check = test_client.post(f"/api/objects/{object_id}/legal-check/ashyq")
    assert check.status_code == 200
    assert check.json()["status"] == "not_found"
    detail = test_client.get(f"/api/objects/{object_id}").json()
    assert detail["score"]["score"] == 0
    assert all(factor["factor_code"] != "R1" for factor in detail["score"]["factors"])


def test_manual_not_found_source_check_is_audited_and_does_not_create_r1(test_client):
    obj = test_client.post("/api/objects", json={"name": "ЖК Тексеру", "developer": "ТОО Үлгі"}).json()
    response = test_client.post(
        f"/api/objects/{obj['id']}/source-checks",
        json={
            "source_id": "qazreestr",
            "status": "not_found",
            "actor": "Аналитик А",
            "comment": "Тексеру жазбасы",
            "source_url": "https://qazreestr.kz",
        },
    )
    assert response.status_code == 201
    assert response.json()["status"] == "not_found"
    detail = test_client.get(f"/api/objects/{obj['id']}").json()
    assert detail["score"]["score"] == 0
    assert not any(factor["factor_code"] == "R1" for factor in detail["score"]["factors"])
    audit = test_client.get(f"/api/objects/{obj['id']}/audit").json()
    assert audit[0]["action"] == "source_check_recorded"
    assert audit[0]["actor"] == "Аналитик А"
