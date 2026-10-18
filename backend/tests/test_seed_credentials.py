from argon2 import PasswordHasher
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
from backend.app.models import User
from backend.seed.seed import seed_auth_users


def test_blank_example_env_generates_usable_passwords(tmp_path, monkeypatch, capsys):
    """Copying .env.example must not create inaccessible accounts with empty passwords."""
    for name in ("ANALYST", "ANALYST_BACKUP", "OBSERVER"):
        monkeypatch.setenv(f"SAQ_PASSWORD_{name}", "")
    generated = "test-generated-first-run-password"
    monkeypatch.setattr("backend.seed.seed.secrets.token_urlsafe", lambda _: generated)
    engine = create_engine(f"sqlite:///{(tmp_path / 'fresh.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    try:
        seed_auth_users(factory)
        with factory() as db:
            users = db.scalars(select(User)).all()
            assert {u.username for u in users} == {"analyst", "analyst.backup", "observer"}
            for user in users:
                assert PasswordHasher().verify(user.password_hash, generated)
                assert user.password_hash != generated
        assert generated in capsys.readouterr().out
    finally:
        engine.dispose()
