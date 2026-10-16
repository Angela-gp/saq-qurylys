import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base, get_db
from backend.app.main import app
from backend.seed.seed import seed_auth_users


@pytest.fixture
def test_client(tmp_path):
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    test_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    seed_auth_users(
        test_session,
        passwords={
            "analyst": "test-analyst-password",
            "analyst.backup": "test-backup-password",
            "observer": "test-observer-password",
        },
        emit=False,
    )

    def override_get_db():
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        assert client.post(
            "/api/auth/login", json={"username": "analyst", "password": "test-analyst-password"}
        ).status_code == 200
        yield client
    app.dependency_overrides.clear()
    engine.dispose()
