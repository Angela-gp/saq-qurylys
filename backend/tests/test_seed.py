import json
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
from backend.app.domain.scoring import calculate_score
from backend.app.models import Evidence, HousingObject, Publication
from backend.seed.seed import load_demo_data


def test_demo_seed_recreates_eight_objects_twelve_publications_and_scenarios(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'seed.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    counts = load_demo_data(factory)
    assert counts == {"objects": 8, "publications": 12}

    seed_dir = Path(__file__).parents[1] / "seed"
    seed_data = json.loads((seed_dir / "seed.json").read_text(encoding="utf-8"))
    scenarios = {
        row["id"]: row for row in json.loads((seed_dir / "scenarios.json").read_text(encoding="utf-8"))
    }
    with factory() as db:
        objects = db.scalars(select(HousingObject).where(HousingObject.is_demo.is_(True))).all()
        publications = db.scalars(select(Publication)).all()
        assert len(objects) == 8
        assert len(publications) == 12
        assert all(obj.bin and len(obj.bin) == 12 and obj.bin.isdigit() for obj in objects)
        assert all("demo" not in obj.name.casefold() and "демо" not in obj.name.casefold() for obj in objects)
        publications_by_id = {publication.id: publication for publication in publications}
        observed = {}
        for obj in objects:
            seed_object = next(item for item in seed_data["objects"] if item["name"] == obj.name)
            scenario = seed_object.get("scenario")
            if scenario:
                evidence = db.scalars(select(Evidence).where(Evidence.housing_object_id == obj.id)).all()
                for item in evidence:
                    if item.quote:
                        assert item.publication_id in publications_by_id
                        assert item.quote in publications_by_id[item.publication_id].text
                observed[scenario] = calculate_score(
                    [
                        {
                            "id": e.id,
                            "factor_code": e.factor_code,
                            "status": e.status,
                            "quote": e.quote,
                            "source_url": e.source_url,
                            "captured_at": e.captured_at.isoformat(),
                        }
                        for e in evidence
                    ],
                    obj.legal_basis_status,
                )
                if scenario == "B":
                    assert observed[scenario]["score"] == 70
                    assert observed[scenario]["zone"] == "red"
                    r2 = next(
                        factor for factor in observed[scenario]["factors"] if factor["factor_code"] == "R2"
                    )
                    evidence_by_id = {item.id: item for item in evidence}
                    assert r2["quote"] == "внесите депозит 150 000 ₸"
                    publication_id = evidence_by_id[r2["evidence_id"]].publication_id
                    assert r2["source_url"] == publications_by_id[publication_id].source_url
        for scenario_id in ("A", "B", "C"):
            expected = scenarios[scenario_id]
            assert observed[scenario_id]["score"] == expected["expected_score"]
            assert observed[scenario_id]["zone"] == expected["expected_zone"]
    engine.dispose()
