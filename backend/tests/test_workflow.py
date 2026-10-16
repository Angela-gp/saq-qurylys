def test_signal_workflow_and_audit_log(test_client):
    response = test_client.post(
        "/api/objects",
        json={"name": "Контрольный ЖК", "status": "construction"},
    )
    assert response.status_code == 201
    object_id = response.json()["id"]

    response = test_client.post(
        f"/api/objects/{object_id}/evidence",
        json={
            "factor_code": "R2",
            "quote": "внесите депозит",
            "source": "manual_test",
            "rationale": "Тестовая гипотеза для проверки workflow.",
        },
    )
    assert response.status_code == 201
    evidence_id = response.json()["id"]
    assert response.json()["status"] == "ai_hypothesis"

    rejected_without_source = test_client.patch(
        f"/api/evidence/{evidence_id}/review",
        json={"status": "fact", "reviewer": "Проверяющий"},
    )
    assert rejected_without_source.status_code == 422

    response = test_client.patch(
        f"/api/evidence/{evidence_id}/review",
        json={
            "status": "fact",
            "reviewer": "Проверяющий",
            "source_url": "https://example.org/ad",
        },
    )
    assert response.status_code == 200
    assert response.json()["score"]["score"] == 25

    response = test_client.post(
        "/api/signals", json={"housing_object_id": object_id, "author": "Автор карточки"}
    )
    assert response.status_code == 201
    signal_id = response.json()["id"]

    invalid_transition = test_client.patch(
        f"/api/signals/{signal_id}/status",
        json={"status": "confirmed", "author": "Проверяющий"},
    )
    assert invalid_transition.status_code == 409

    response = test_client.patch(
        f"/api/signals/{signal_id}/status",
        json={"status": "in_review", "author": "Проверяющий"},
    )
    assert response.status_code == 200
    returned_without_comment = test_client.patch(
        f"/api/signals/{signal_id}/status",
        json={"status": "returned", "author": "Проверяющий", "comment": ""},
    )
    assert returned_without_comment.status_code == 422

    response = test_client.patch(
        f"/api/signals/{signal_id}/status",
        json={"status": "returned", "author": "Проверяющий", "comment": "Нужна ссылка"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "returned"
    assert response.json()["comments"][-1]["author"] == "Аналитик А"
    assert response.json()["comments"][-1]["created_at"].endswith("+00:00")

    response = test_client.patch(
        f"/api/signals/{signal_id}/status",
        json={"status": "in_review", "author": "Проверяющий", "comment": "Источник приложен"},
    )
    assert response.status_code == 200
    response = test_client.patch(
        f"/api/signals/{signal_id}/status",
        json={"status": "confirmed", "author": "Утверждающий", "comment": "Проверено"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "confirmed"

    audit = test_client.get(f"/api/objects/{object_id}/audit")
    assert audit.status_code == 200
    assert any(
        row["action"] == "signal_status_changed"
        and row["actor"] == "Аналитик А"
        and row["details"]["status"] == "confirmed"
        and row["created_at"].endswith("+00:00")
        for row in audit.json()
    )


def test_deposit_publication_stays_zero_until_analyst_confirms_hypothesis(test_client):
    obj = test_client.post(
        "/api/objects", json={"name": "ЖК Тестовый депозит", "status": "construction"}
    ).json()
    assert obj["score"]["score"] == 0
    publication = test_client.post(
        "/api/publications",
        json={
            "text": "Внесите депозит 500 000 за бронь квартиры в строящемся доме.",
            "source": "manual",
            "source_url": "https://example.org/synthetic-ad",
            "housing_object_id": obj["id"],
        },
    )
    assert publication.status_code == 201
    assert publication.json()["extraction"]["quote_valid"] is True
    hypothesis = publication.json()["evidence"][0]
    assert hypothesis["status"] == "ai_hypothesis"
    assert test_client.get(f"/api/objects/{obj['id']}").json()["score"]["score"] == 0
    confirmed = test_client.patch(
        f"/api/evidence/{hypothesis['id']}/review",
        json={
            "status": "fact",
            "reviewer": "Аналитик",
            "source_url": "https://example.org/synthetic-ad",
        },
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["score"]["score"] == 25


def test_object_creation_adds_r5_hypothesis_only_at_20_points(test_client):
    below = test_client.post(
        "/api/objects",
        json={"name": "Разрыв 19", "readiness": 41, "declared_readiness": 60},
    )
    at_threshold = test_client.post(
        "/api/objects",
        json={"name": "Разрыв 20", "readiness": 40, "declared_readiness": 60},
    )
    assert below.status_code == at_threshold.status_code == 201
    below_detail = test_client.get(f"/api/objects/{below.json()['id']}").json()
    threshold_detail = test_client.get(f"/api/objects/{at_threshold.json()['id']}").json()
    assert not any(e["factor_code"] == "R5" for e in below_detail["evidence"])
    assert any(
        e["factor_code"] == "R5" and e["status"] == "ai_hypothesis" for e in threshold_detail["evidence"]
    )


def test_unlinked_publication_can_be_linked_after_analyst_selects_candidate(test_client):
    created = test_client.post(
        "/api/objects",
        json={"name": "ЖК Кандидат", "status": "construction"},
    )
    object_id = created.json()["id"]
    publication = test_client.post(
        "/api/publications",
        json={
            "text": "Внесите депозит за бронь квартиры в новом доме.",
            "source": "manual_test",
            "source_url": "https://example.org/publication",
        },
    )
    assert publication.status_code == 201
    assert publication.json()["housing_object_id"] is None
    assert publication.json()["evidence"] == []

    linked = test_client.patch(
        f"/api/publications/{publication.json()['publication_id']}/object",
        json={"housing_object_id": object_id},
    )
    assert linked.status_code == 200
    assert linked.json()["housing_object_id"] == object_id
    assert {item["factor_code"] for item in linked.json()["evidence"]} == {"R2", "R3"}
    assert all(item["status"] == "ai_hypothesis" for item in linked.json()["evidence"])


def test_production_spa_route_falls_back_to_frontend_index(test_client):
    response = test_client.get("/signals")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert '<div id="root"></div>' in response.text
