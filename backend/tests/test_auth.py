from fastapi.testclient import TestClient

from backend.app.auth import hash_password
from backend.app.main import app


def test_api_requires_a_session(test_client):
    with TestClient(app) as anonymous:
        response = anonymous.get("/api/objects")
    assert response.status_code == 401
    assert response.json()["error_code"] == "authentication_required"


def test_wrong_password_is_rejected(test_client):
    response = test_client.post(
        "/api/auth/login", json={"username": "analyst", "password": "not-the-password"}
    )
    assert response.status_code == 401
    assert response.json()["error_code"] == "invalid_credentials"


def test_seed_password_hash_uses_argon2():
    assert hash_password("test-password-value").startswith("$argon2id$")


def test_login_attempts_are_limited(test_client):
    username = "rate-limit-test-user"
    for _ in range(5):
        response = test_client.post("/api/auth/login", json={"username": username, "password": "wrong"})
        assert response.status_code == 401
    limited = test_client.post("/api/auth/login", json={"username": username, "password": "wrong"})
    assert limited.status_code == 429
    assert limited.json()["error_code"] == "login_rate_limited"


def test_observer_cannot_confirm_signal(test_client):
    obj = test_client.post("/api/objects", json={"name": "Тестовый объект", "status": "construction"}).json()
    test_client.post(
        f"/api/objects/{obj['id']}/evidence",
        json={"factor_code": "R2", "quote": "депозит", "source": "test", "rationale": "Тестовая гипотеза."},
    )
    signal = test_client.post(
        "/api/signals",
        json={"housing_object_id": obj["id"], "author": "Подмена автора"},
    ).json()
    test_client.patch(
        f"/api/signals/{signal['id']}/status",
        json={"status": "in_review", "author": "Подмена автора"},
    )

    with TestClient(app) as observer:
        logged_in = observer.post(
            "/api/auth/login", json={"username": "observer", "password": "test-observer-password"}
        )
        assert logged_in.status_code == 200
        assert logged_in.json()["user"]["role"] == "observer"
        rejected = observer.patch(
            f"/api/signals/{signal['id']}/status",
            json={"status": "confirmed", "author": "Администратор"},
        )

    assert rejected.status_code == 403
    assert rejected.json()["error_code"] == "analyst_role_required"


def test_audit_author_comes_from_session_not_request_body(test_client):
    obj = test_client.post("/api/objects", json={"name": "Аудит объекта"}).json()
    signal = test_client.post(
        "/api/signals", json={"housing_object_id": obj["id"], "author": "Поддельный автор"}
    ).json()
    assert signal["id"]
    audit = test_client.get(f"/api/objects/{obj['id']}/audit").json()
    created = next(item for item in audit if item["action"] == "signal_created")
    assert created["actor"] == "Аналитик А"
