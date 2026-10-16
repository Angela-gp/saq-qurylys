"""Load explicitly requested, fictional control data. Normal app startup stays empty."""

import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select

from backend.app.auth import hash_password
from backend.app.database import Base, SessionLocal, engine
from backend.app.models import AuditLog, Evidence, HousingObject, Publication, Signal, User

DEMO_EVIDENCE_SOURCES = {
    "demo-jk-001": {
        "R2": ("demo-ad-001", "депозитом 100 000 ₸"),
        "R3": ("demo-ad-002", "Продажи квартир в строящемся ЖК Күмбез-47."),
    },
    "demo-jk-002": {
        "R2": ("demo-ad-003", "внесите депозит 150 000 ₸"),
        "R3": ("demo-ad-004", "Старт продаж квартир в ЖК Қоңырсай-71."),
    },
    "demo-jk-003": {"R3": ("demo-ad-005", "Квартиры в строящемся доме.")},
}


def load_demo_data(session_factory=SessionLocal):
    Base.metadata.create_all(engine)
    seed_path = Path(__file__).with_name("seed.json")
    data = json.loads(seed_path.read_text(encoding="utf-8"))
    with session_factory() as db:
        demo_ids = list(db.scalars(select(HousingObject.id).where(HousingObject.is_demo.is_(True))).all())
        if demo_ids:
            db.execute(delete(Signal).where(Signal.housing_object_id.in_(demo_ids)))
            db.execute(delete(AuditLog).where(AuditLog.housing_object_id.in_(demo_ids)))
            db.execute(delete(Evidence).where(Evidence.housing_object_id.in_(demo_ids)))
            db.execute(delete(Publication).where(Publication.housing_object_id.in_(demo_ids)))
            db.execute(delete(HousingObject).where(HousingObject.id.in_(demo_ids)))
        db.commit()
        objects = {}
        for row in data["objects"]:
            obj = HousingObject(
                name=row["name"],
                developer=row.get("developer", ""),
                bin=row.get("bin"),
                address=row.get("address", ""),
                region="Восточно-Казахстанская область · ДЕМО",
                status="construction",
                readiness=row.get("readiness_verified"),
                declared_readiness=row.get("readiness_declared"),
                legal_basis_status=row.get("legal_basis_status", "not_checked"),
                legal_basis_type=row.get("legal_basis_type"),
                legal_source_url=None,
                latitude=row.get("lat"),
                longitude=row.get("lng"),
                is_demo=True,
            )
            db.add(obj)
            db.flush()
            objects[row["id"]] = obj
        publications = {}
        for row in data.get("publications", []):
            obj = objects.get(row.get("object_id"))
            publication = Publication(
                housing_object_id=obj.id if obj else None,
                source=row.get("source_platform", "ДЕМО"),
                source_url=row.get("url"),
                text=row.get("text", ""),
                published_at=(
                    datetime.fromisoformat(row["date"]).replace(tzinfo=timezone.utc)
                    if row.get("date")
                    else None
                ),
                extraction={"mode": "demo", "label": "ДЕМО"},
            )
            db.add(publication)
            db.flush()
            publications[row["id"]] = publication
        scenario_rows = {
            row["id"]: row
            for row in json.loads(Path(__file__).with_name("scenarios.json").read_text(encoding="utf-8"))
        }
        for row in data["objects"]:
            scenario = scenario_rows.get(row.get("scenario"))
            if not scenario:
                continue
            obj = objects[row["id"]]
            for code in scenario["factors"]:
                citation = DEMO_EVIDENCE_SOURCES.get(row["id"], {}).get(code)
                publication = publications.get(citation[0]) if citation else None
                quote = citation[1] if citation else None
                if publication and quote not in publication.text:
                    raise ValueError(f"Seed quote for {code} is missing from {citation[0]}")
                db.add(
                    Evidence(
                        housing_object_id=obj.id,
                        publication_id=publication.id if publication else None,
                        factor_code=code,
                        status="fact",
                        quote=quote,
                        source=publication.source if publication else "ДЕМО · контрольный сценарий",
                        source_url=publication.source_url if publication else None,
                        captured_at=(
                            datetime.fromisoformat(
                                next(p["date"] for p in data["publications"] if p["id"] == citation[0])
                            ).replace(tzinfo=timezone.utc)
                            if citation
                            else datetime.now(timezone.utc)
                        ),
                        rationale=(
                            "Вымышленный фактор контрольного сценария; цитата совпадает "
                            "с текстом ДЕМО-публикации."
                        ),
                    )
                )
        db.commit()
    return {"objects": len(objects), "publications": len(data.get("publications", []))}


def seed_auth_users(session_factory=SessionLocal, passwords: dict[str, str] | None = None, emit=True):
    """Create fictional accounts once, storing only Argon2 hashes."""
    Base.metadata.create_all(engine)
    config_path = Path(__file__).with_name("users.json")
    users_config = json.loads(config_path.read_text(encoding="utf-8"))
    created = []
    with session_factory() as db:
        for item in users_config:
            if db.scalar(select(User).where(User.username == item["username"])):
                continue
            password = (passwords or {}).get(item["username"]) or os.getenv(item["password_env"])
            generated = password is None
            if generated:
                password = secrets.token_urlsafe(18)
            user = User(
                username=item["username"],
                display_name=item["display_name"],
                role=item["role"],
                password_hash=hash_password(password),
                active=True,
            )
            db.add(user)
            if generated:
                created.append((user.username, password))
        db.commit()
    if emit:
        if created:
            print("Сохраните одноразовые пароли новых пользователей сейчас:")
            for username, password in created:
                print(f"  {username}: {password}")
        else:
            print("Учётные записи уже созданы или заданы через локальный .env.")
    return {"created": len(created)}


def main():
    seed_auth_users()
    counts = load_demo_data()
    print(
        f"Загружено объектов ДЕМО: {counts['objects']}, "
        f"публикаций: {counts['publications']}. Это фиктивные контрольные данные."
    )


if __name__ == "__main__":
    main()
