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

    audit = test_client.get(f"/api/objects/{imported['id']}/audit").json()
    assert audit[0]["details"]["source_id"] == "1"
    assert audit[0]["details"]["permission_number"] == "PERMIT-1"
