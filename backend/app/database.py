from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()


class Base(DeclarativeBase):
    pass


def database_url() -> str:
    default = Path(__file__).resolve().parents[1] / "data" / "saq_qurylys.db"
    default.parent.mkdir(parents=True, exist_ok=True)
    return os.getenv("DATABASE_URL", f"sqlite:///{default.as_posix()}")


engine = create_engine(
    database_url(), connect_args={"check_same_thread": False} if database_url().startswith("sqlite") else {}
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
