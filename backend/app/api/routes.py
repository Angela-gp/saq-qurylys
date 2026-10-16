from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.adapters.ashyq import AshyqAdapter
from backend.app.adapters.ashyq_import import (
    DATASET_NAME,
    DATASET_URL,
    looks_like_person_name,
    map_row,
    parse_rows,
    record_key,
)
from backend.app.adapters.telegram_import import parse_telegram_export
from backend.app.ai.extractor import extract_payment_offer
from backend.app.auth import get_current_user, router_actor
from backend.app.database import get_db
from backend.app.domain.scoring import calculate_score, has_readiness_mismatch, readiness_gap
from backend.app.models import (
    AuditLog,
    Evidence,
    HousingObject,
    LegalBasisCheck,
    Publication,
    RegistryRecord,
    Signal,
    SourceReview,
)
from backend.app.schemas import (
    EvidenceCreate,
    EvidenceReview,
    LegalBasisUpdate,
    ObjectCreate,
    PublicationCreate,
    PublicationLinkUpdate,
    SignalCreate,
    SignalTransition,
    SourceReviewCreate,
)
from backend.seed.seed import load_demo_data

router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
SCREENSHOT_DIR = Path(__file__).resolve().parents[2] / "data" / "screenshots"
ASHYQ_PUBLIC_FIELDS = (
    "source_record_id",
    "name",
    "location",
    "address",
    "developer",
    "permission_number",
    "permission_start",
    "permission_end",
    "modified_at",
)
ALLOWED_TRANSITIONS = {
    "draft": {"in_review"},
    "in_review": {"confirmed", "returned"},
    "returned": {"in_review"},
    "confirmed": set(),
}
SOURCE_LINKS = [
    {
        "id": "homeportal",
        "name": "Жилищный портал КЖК",
        "url": "https://homeportal.kz",
        "status": "manual_review",
    },
    {"id": "elicense", "name": "E-License", "url": "https://elicense.kz", "status": "manual_review"},
    {"id": "qazreestr", "name": "Qazreestr", "url": "https://qazreestr.kz", "status": "manual_review"},
    {
        "id": "ashyq",
        "name": "Ashyq Data · Казреестр",
        "url": "https://ashyq.data.gov.kz/dataset/magda-ds-b80110e9-218a-42ba-b8c8-01fa5e4c82c8",
        "status": "api_metadata",
    },
    {
        "id": "equrylys",
        "name": "eQurylys",
        "url": "https://reestr.equrylys.kz/organizations",
        "status": "manual_review",
    },
    {"id": "egov", "name": "eGov · юридические лица", "url": "https://egov.kz", "status": "manual_review"},
    {
        "id": "kgd",
        "name": "КГД · налоговая задолженность",
        "url": "https://kgd.gov.kz",
        "status": "manual_review",
    },
    {
        "id": "rsp",
        "name": "Реестр субъектов предпринимательства",
        "url": "https://rsp.gov.kz",
        "status": "manual_review",
    },
    {
        "id": "cadastre",
        "name": "Публичная кадастровая карта",
        "url": "https://map.gov4c.kz/egkn/",
        "status": "manual_review",
    },
    {
        "id": "procurement",
        "name": "РНУ госзакупок",
        "url": "https://procurement.gov.kz/ru/registry/rnu",
        "status": "manual_review",
    },
]


def _log(
    db: Session,
    action: str,
    housing_object_id: int | None = None,
    entity_type: str = "object",
    entity_id: int | None = None,
    actor: str | None = None,
    details: dict | None = None,
):
    db.add(
        AuditLog(
            housing_object_id=housing_object_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            actor=actor or router_actor.get(),
            details=details or {},
        )
    )


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _score(obj: HousingObject) -> dict:
    return calculate_score(
        [
            {
                "id": e.id,
                "factor_code": e.factor_code,
                "status": e.status,
                "quote": e.quote,
                "source": e.source,
                "source_url": e.source_url,
                "captured_at": e.captured_at.isoformat(),
                "review_reason": e.rationale,
            }
            for e in obj.evidence
        ],
        obj.legal_basis_status,
    )


def _object_json(obj: HousingObject) -> dict:
    latest_check = max(obj.legal_checks, key=lambda item: item.id, default=None)
    return {
        "id": obj.id,
        "name": obj.name,
        "developer": obj.developer,
        "bin": obj.bin,
        "address": obj.address,
        "region": obj.region,
        "status": obj.status,
        "readiness": obj.readiness,
        "declared_readiness": obj.declared_readiness,
        "legal_basis_status": obj.legal_basis_status,
        "legal_basis_type": obj.legal_basis_type,
        "legal_source_url": obj.legal_source_url,
        "latitude": obj.latitude,
        "longitude": obj.longitude,
        "is_demo": obj.is_demo,
        "legal_check": (
            {
                "status": latest_check.status,
                "dataset_name": latest_check.dataset_name,
                "imported_at": _iso(latest_check.imported_at),
                "source_url": latest_check.source_url,
                "registry_record_id": latest_check.registry_record_id,
            }
            if latest_check
            else None
        ),
        "score": _score(obj),
        "created_at": _iso(obj.created_at),
    }


def _evidence_json(item: Evidence) -> dict:
    return {
        "id": item.id,
        "factor_code": item.factor_code,
        "status": item.status,
        "quote": item.quote,
        "source": item.source,
        "source_url": item.source_url,
        "rationale": item.rationale,
        "captured_at": _iso(item.captured_at),
        "reviewed_by": item.reviewed_by,
        "reviewed_at": _iso(item.reviewed_at),
        "publication_id": item.publication_id,
    }


@router.get("/health")
def health():
    return {"status": "ok", "application": "SAQ QURYLYS"}


@router.get("/objects")
def objects(
    q: str | None = Query(default=None, max_length=200),
    zone: str | None = Query(default=None, pattern="^(red|yellow|green)$"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=10000, ge=1, le=25000),
    db: Session = Depends(get_db),
):
    statement = select(HousingObject).order_by(HousingObject.id)
    if q and q.strip():
        term = q.strip().replace("%", "\\%").replace("_", "\\_")
        search = f"%{term}%"
        statement = statement.where(
            HousingObject.name.ilike(search, escape="\\")
            | HousingObject.developer.ilike(search, escape="\\")
            | HousingObject.address.ilike(search, escape="\\")
        )
    rows = db.scalars(statement).all()
    if zone:
        rows = [
            obj for obj in rows if (obj.is_demo or _score(obj)["factors"]) and _score(obj)["zone"] == zone
        ]
    return [_object_json(obj) for obj in rows[offset : offset + limit]]


@router.post("/objects", status_code=201)
def create_object(payload: ObjectCreate, db: Session = Depends(get_db)):
    obj = HousingObject(**payload.model_dump())
    db.add(obj)
    db.flush()
    if has_readiness_mismatch(obj.declared_readiness, obj.readiness):
        gap = readiness_gap(obj.declared_readiness, obj.readiness)
        db.add(
            Evidence(
                housing_object_id=obj.id,
                factor_code="R5",
                status="ai_hypothesis",
                source="analyst_readiness_entry",
                rationale=(
                    f"Заявленная готовность {obj.declared_readiness:g}%; "
                    f"введённая подтверждённая готовность {obj.readiness:g}%; "
                    f"разница {gap:g} п.п. Проверьте даты и первичные источники."
                ),
            )
        )
    _log(db, "created", obj.id, details={"name": obj.name})
    db.commit()
    db.refresh(obj)
    return _object_json(obj)


@router.get("/objects/{object_id}")
def object_detail(object_id: int, db: Session = Depends(get_db)):
    obj = db.get(HousingObject, object_id)
    if not obj:
        raise HTTPException(404, "Объект не найден")
    return {
        **_object_json(obj),
        "evidence": [_evidence_json(e) for e in obj.evidence],
        "source_checks": [
            {
                "id": row.id,
                "source_id": row.source_id,
                "status": row.status,
                "actor": row.actor,
                "comment": row.comment,
                "source_url": row.source_url,
                "screenshot_path": row.screenshot_path,
                "created_at": _iso(row.created_at),
            }
            for row in db.scalars(
                select(SourceReview)
                .where(SourceReview.housing_object_id == obj.id)
                .order_by(SourceReview.created_at.desc())
            ).all()
        ],
        "publications": [
            {
                "id": p.id,
                "source": p.source,
                "source_url": p.source_url,
                "text": p.text,
                "published_at": _iso(p.published_at),
                "extraction": p.extraction,
            }
            for p in obj.publications
        ],
    }


@router.patch("/objects/{object_id}/legal-basis")
def update_legal_basis(object_id: int, payload: LegalBasisUpdate, db: Session = Depends(get_db)):
    obj = db.get(HousingObject, object_id)
    if not obj:
        raise HTTPException(404, "Объект не найден")
    previous = obj.legal_basis_status
    obj.legal_basis_status = payload.status
    obj.legal_basis_type = payload.basis_type if payload.status == "confirmed" else None
    obj.legal_source_url = payload.source_url
    if payload.status == "absent":
        db.add(
            Evidence(
                housing_object_id=obj.id,
                factor_code="R1",
                status="fact",
                source="manual_registry_check",
                source_url=payload.source_url,
                rationale=payload.note,
                reviewed_by=router_actor.get(),
                reviewed_at=datetime.now(timezone.utc),
            )
        )
    elif payload.status in {"confirmed", "not_checked"}:
        for item in obj.evidence:
            if item.factor_code == "R1" and item.status == "fact":
                item.status = "rejected"
                item.reviewed_by = router_actor.get()
                item.reviewed_at = datetime.now(timezone.utc)
    _log(
        db,
        "legal_basis_updated",
        obj.id,
        actor=router_actor.get(),
        details={
            "from": previous,
            "to": payload.status,
            "basis_type": payload.basis_type,
            "source_url": payload.source_url,
            "note": payload.note,
        },
    )
    db.commit()
    db.refresh(obj)
    return _object_json(obj)


@router.get("/objects/{object_id}/audit")
def audit(object_id: int, db: Session = Depends(get_db)):
    if not db.get(HousingObject, object_id):
        raise HTTPException(404, "Объект не найден")
    rows = db.scalars(
        select(AuditLog).where(AuditLog.housing_object_id == object_id).order_by(AuditLog.created_at.desc())
    ).all()
    return [
        {
            "id": row.id,
            "action": row.action,
            "entity_type": row.entity_type,
            "entity_id": row.entity_id,
            "actor": row.actor,
            "details": row.details,
            "created_at": _iso(row.created_at),
        }
        for row in rows
    ]


@router.get("/matches")
def matches(q: str, db: Session = Depends(get_db)):
    candidates = []
    for obj in db.scalars(select(HousingObject)).all():
        name_score = fuzz.WRatio(q, obj.name)
        developer_score = fuzz.WRatio(q, obj.developer) if obj.developer else 0
        confidence = max(name_score, developer_score)
        if confidence >= 35:
            candidates.append(
                {
                    "object_id": obj.id,
                    "name": obj.name,
                    "developer": obj.developer,
                    "confidence": round(confidence / 100, 3),
                    "score": _score(obj),
                }
            )
    return sorted(candidates, key=lambda x: x["confidence"], reverse=True)[:10]


@router.post("/publications", status_code=201)
async def create_publication(payload: PublicationCreate, db: Session = Depends(get_db)):
    if payload.housing_object_id and not db.get(HousingObject, payload.housing_object_id):
        raise HTTPException(404, "Объект не найден")
    parsed = await extract_payment_offer(payload.text)
    obj = db.get(HousingObject, payload.housing_object_id) if payload.housing_object_id else None
    publication = Publication(
        housing_object_id=payload.housing_object_id,
        source=payload.source,
        source_url=payload.source_url,
        text=payload.text,
        published_at=payload.published_at,
        extraction=parsed.model_dump(),
    )
    db.add(publication)
    db.flush()
    evidence = []
    if obj and parsed.has_payment_offer:
        item = Evidence(
            housing_object_id=obj.id,
            publication_id=publication.id,
            factor_code="R2",
            status="ai_hypothesis",
            quote=parsed.quote,
            source=payload.source,
            source_url=payload.source_url,
            rationale=f"Гипотеза {parsed.mode}, уверенность {parsed.confidence:.0%}: {parsed.reasoning}",
        )
        db.add(item)
        db.flush()
        evidence.append(item)
    if obj and obj.status in {"construction", "under_construction", "строится"}:
        item = Evidence(
            housing_object_id=obj.id,
            publication_id=publication.id,
            factor_code="R3",
            status="ai_hypothesis",
            quote=payload.text[:300],
            source=payload.source,
            source_url=payload.source_url,
            rationale="Реклама связана с объектом; проверьте, что объект ещё строится.",
        )
        db.add(item)
        db.flush()
        evidence.append(item)
    _log(
        db,
        "publication_added",
        obj.id if obj else None,
        entity_type="publication",
        entity_id=publication.id,
        details={
            "source": payload.source,
            "has_payment_offer": parsed.has_payment_offer,
            "mode": parsed.mode,
        },
    )
    db.commit()
    return {
        "publication_id": publication.id,
        "housing_object_id": publication.housing_object_id,
        "extraction": parsed.model_dump(),
        "evidence": [_evidence_json(e) for e in evidence],
        "matches": matches(payload.text[:200], db),
    }


@router.patch("/publications/{publication_id}/object")
def link_publication(publication_id: int, payload: PublicationLinkUpdate, db: Session = Depends(get_db)):
    publication = db.get(Publication, publication_id)
    obj = db.get(HousingObject, payload.housing_object_id)
    if not publication:
        raise HTTPException(404, "Публикация не найдена")
    if not obj:
        raise HTTPException(404, "Объект не найден")
    publication.housing_object_id = obj.id
    extraction = publication.extraction or {}
    added = []
    if extraction.get("has_payment_offer") and not db.scalar(
        select(Evidence.id).where(Evidence.publication_id == publication.id, Evidence.factor_code == "R2")
    ):
        item = Evidence(
            housing_object_id=obj.id,
            publication_id=publication.id,
            factor_code="R2",
            status="ai_hypothesis",
            quote=extraction.get("quote"),
            source=publication.source,
            source_url=publication.source_url,
            rationale=(
                f"Гипотеза {extraction.get('mode', 'rules')}, "
                f"уверенность {float(extraction.get('confidence', 0)):.0%}: "
                f"{extraction.get('reasoning', '')}"
            ),
        )
        db.add(item)
        db.flush()
        added.append(item)
    if obj.status in {"construction", "under_construction", "строится"} and not db.scalar(
        select(Evidence.id).where(Evidence.publication_id == publication.id, Evidence.factor_code == "R3")
    ):
        item = Evidence(
            housing_object_id=obj.id,
            publication_id=publication.id,
            factor_code="R3",
            status="ai_hypothesis",
            quote=publication.text[:300],
            source=publication.source,
            source_url=publication.source_url,
            rationale="Реклама связана с объектом; проверьте, что объект ещё строится.",
        )
        db.add(item)
        db.flush()
        added.append(item)
    _log(
        db,
        "publication_linked",
        obj.id,
        "publication",
        publication.id,
        details={"object_name": obj.name},
    )
    db.commit()
    return {
        "publication_id": publication.id,
        "housing_object_id": obj.id,
        "evidence": [_evidence_json(item) for item in added],
    }


@router.post("/publications/{publication_id}/screenshot")
async def upload_publication_screenshot(
    publication_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    publication = db.get(Publication, publication_id)
    if not publication:
        raise HTTPException(404, "publication_not_found")
    extensions = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
    suffix = extensions.get(file.content_type or "")
    if not suffix:
        raise HTTPException(415, "unsupported_image_type")
    content = await file.read(5_000_001)
    if len(content) > 5_000_000:
        raise HTTPException(413, "image_too_large")
    if not content:
        raise HTTPException(422, "empty_image")
    signatures = {
        ".jpg": content.startswith(b"\xff\xd8\xff"),
        ".png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        ".webp": len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP",
    }
    if not signatures[suffix]:
        raise HTTPException(415, "invalid_image_content")
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{publication_id}-{hashlib.sha256(content).hexdigest()[:20]}{suffix}"
    old_name = (publication.extraction or {}).get("screenshot_file")
    if old_name and old_name != filename:
        old_path = SCREENSHOT_DIR / Path(old_name).name
        old_path.unlink(missing_ok=True)
    (SCREENSHOT_DIR / filename).write_bytes(content)
    publication.extraction = {**(publication.extraction or {}), "screenshot_file": filename}
    db.commit()
    return {"path": f"/api/publications/{publication_id}/screenshot"}


@router.get("/publications/{publication_id}/screenshot")
def get_publication_screenshot(publication_id: int, db: Session = Depends(get_db)):
    publication = db.get(Publication, publication_id)
    filename = (publication.extraction or {}).get("screenshot_file") if publication else None
    if not filename:
        raise HTTPException(404, "screenshot_not_found")
    path = SCREENSHOT_DIR / Path(filename).name
    if not path.is_file():
        raise HTTPException(404, "screenshot_not_found")
    return FileResponse(path)


@router.post("/objects/{object_id}/evidence", status_code=201)
def add_evidence(object_id: int, payload: EvidenceCreate, db: Session = Depends(get_db)):
    obj = db.get(HousingObject, object_id)
    if not obj:
        raise HTTPException(404, "Объект не найден")
    if payload.factor_code == "R1":
        raise HTTPException(422, "R1 фиксируется только через проверку правового основания с источником")
    item = Evidence(
        housing_object_id=obj.id,
        factor_code=payload.factor_code,
        status="ai_hypothesis",
        quote=payload.quote,
        source=payload.source,
        source_url=payload.source_url,
        rationale=payload.rationale,
    )
    db.add(item)
    db.flush()
    _log(
        db,
        "evidence_hypothesis_added",
        obj.id,
        "evidence",
        item.id,
        details={"factor_code": item.factor_code},
    )
    db.commit()
    db.refresh(item)
    return _evidence_json(item)


@router.patch("/evidence/{evidence_id}/review")
def review_evidence(evidence_id: int, payload: EvidenceReview, db: Session = Depends(get_db)):
    item = db.get(Evidence, evidence_id)
    if not item:
        raise HTTPException(404, "Фактор не найден")
    if payload.source_url:
        item.source_url = payload.source_url
    if payload.status == "fact" and not item.source_url:
        raise HTTPException(422, "Для подтверждения фактора сохраните ссылку на источник")
    if payload.status == "fact" and item.factor_code in {"R2", "R3"} and not item.quote:
        raise HTTPException(422, "Для подтверждения фактора рекламы нужна точная цитата")
    item.status = payload.status
    item.reviewed_by = router_actor.get()
    item.reviewed_at = datetime.now(timezone.utc)
    if payload.comment:
        item.rationale = f"{item.rationale}\nКомментарий аналитика: {payload.comment}".strip()
    _log(
        db,
        "evidence_reviewed",
        item.housing_object_id,
        "evidence",
        item.id,
        router_actor.get(),
        {"status": payload.status, "comment": payload.comment},
    )
    db.commit()
    db.refresh(item)
    return {"evidence": _evidence_json(item), "score": _score(item.housing_object)}


@router.get("/sources")
async def sources(db: Session = Depends(get_db)):
    result = []
    ashq_stats = db.query(RegistryRecord).filter(RegistryRecord.source_id == "ashyq").count()
    latest_import = (
        db.query(RegistryRecord)
        .filter(RegistryRecord.source_id == "ashyq")
        .order_by(RegistryRecord.imported_at.desc())
        .first()
    )
    for source in SOURCE_LINKS:
        if source["id"] == "ashyq":
            metadata = await AshyqAdapter().fetch()
            result.append(
                {
                    **metadata,
                    "record_count": ashq_stats,
                    "imported_at": _iso(latest_import.imported_at) if latest_import else None,
                    "dataset_name": latest_import.dataset_name if latest_import else DATASET_NAME,
                    "connection_mode": "connected" if ashq_stats else "not_connected",
                }
            )
        else:
            result.append(
                {
                    **source,
                    "message": None,
                    "message_code": "manual_review_only",
                }
            )
    return result


@router.post("/objects/{object_id}/source-checks", status_code=201)
def create_source_check(object_id: int, payload: SourceReviewCreate, db: Session = Depends(get_db)):
    if not db.get(HousingObject, object_id):
        raise HTTPException(404, "object_not_found")
    allowed = {source["id"] for source in SOURCE_LINKS}
    if payload.source_id not in allowed:
        raise HTTPException(422, "unknown_source")
    item = SourceReview(
        housing_object_id=object_id,
        **payload.model_dump(exclude={"actor"}),
        actor=router_actor.get(),
    )
    db.add(item)
    db.flush()
    _log(
        db,
        "source_check_recorded",
        object_id,
        "source_review",
        item.id,
        router_actor.get(),
        {
            "source_id": item.source_id,
            "status": item.status,
            "source_url": item.source_url,
            "comment": item.comment,
        },
    )
    db.commit()
    db.refresh(item)
    return {
        "id": item.id,
        "source_id": item.source_id,
        "status": item.status,
        "actor": item.actor,
        "comment": item.comment,
        "source_url": item.source_url,
        "created_at": _iso(item.created_at),
    }


@router.post("/import/ashyq", status_code=201)
async def import_ashyq(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if file.filename is None or not file.filename.lower().endswith((".csv", ".xlsx", ".xlsm")):
        raise HTTPException(415, "unsupported_file_type")
    raw = await file.read(5_000_001)
    if len(raw) > 5_000_000:
        raise HTTPException(413, "file_too_large")
    try:
        rows = parse_rows(raw, file.filename)
    except (UnicodeDecodeError, StopIteration, ValueError, OSError) as error:
        raise HTTPException(422, "invalid_file_format") from error
    if len(rows) > 25000:
        raise HTTPException(413, "too_many_rows")
    accepted = []
    skipped = []
    imported = updated = duplicates = 0
    imported_at = datetime.now(timezone.utc)
    for row_number, row in enumerate(rows, start=2):
        mapped = map_row(row)
        name = (mapped.get("name") or "").strip()
        if not name:
            skipped.append({"row_number": row_number, "reason_code": "missing_object_name"})
            continue
        if looks_like_person_name(name):
            skipped.append({"row_number": row_number, "reason_code": "personal_name_in_object_name"})
            continue
        if len(name) > 300:
            skipped.append({"row_number": row_number, "reason_code": "object_name_too_long"})
            continue
        developer = (mapped.get("developer") or "").strip()
        # Do not retain names of sole proprietors/signatories as public company data.
        if looks_like_person_name(developer):
            developer = "Индивидуальный предприниматель"
        address = (mapped.get("address") or "").strip()[:500]
        source_record_id = mapped.get("source_record_id")
        key = record_key(mapped)
        existing_record = db.scalar(select(RegistryRecord).where(RegistryRecord.dedupe_key == key))
        if existing_record:
            obj = db.get(HousingObject, existing_record.housing_object_id)
            if obj:
                obj.name = name
                obj.developer = developer
                obj.bin = mapped.get("bin")
                obj.address = address
                obj.is_demo = False
                existing_record.imported_at = imported_at
                existing_record.source_url = DATASET_URL
                existing_record.dataset_name = DATASET_NAME
                existing_record.permission_number = mapped.get("permission_number")
                existing_record.permission_start = mapped.get("permission_start")
                existing_record.permission_end = mapped.get("permission_end")
                # Retain configured public columns only; unknown and personal fields are discarded.
                existing_record.payload = {
                    key: mapped.get(key) for key in ASHYQ_PUBLIC_FIELDS if mapped.get(key) is not None
                }
                db.add(
                    LegalBasisCheck(
                        housing_object_id=obj.id,
                        status="found",
                        dataset_name=DATASET_NAME,
                        imported_at=imported_at,
                        source_url=DATASET_URL,
                        registry_record_id=existing_record.id,
                    )
                )
                updated += 1
                accepted.append({"row_number": row_number, "status": "updated", "object_id": obj.id})
                continue
        # Merge a newly seen source row into an existing real object when it clearly matches.
        obj = db.scalar(
            select(HousingObject).where(
                HousingObject.is_demo.is_(False),
                HousingObject.name == name,
                HousingObject.developer == developer,
                HousingObject.address == address,
            )
        )
        if obj:
            duplicates += 1
        else:
            obj = HousingObject(
                name=name,
                developer=developer,
                bin=mapped.get("bin"),
                address=address,
                region="",
                status="unknown",
                legal_basis_status="not_checked",
                is_demo=False,
            )
            db.add(obj)
            db.flush()
            imported += 1
        record = RegistryRecord(
            source_record_id=source_record_id,
            dedupe_key=key,
            housing_object_id=obj.id,
            dataset_name=DATASET_NAME,
            source_url=DATASET_URL,
            imported_at=imported_at,
            permission_number=mapped.get("permission_number"),
            permission_start=mapped.get("permission_start"),
            permission_end=mapped.get("permission_end"),
            payload={key: mapped.get(key) for key in ASHYQ_PUBLIC_FIELDS if mapped.get(key) is not None},
        )
        db.add(record)
        db.flush()
        db.add(
            LegalBasisCheck(
                housing_object_id=obj.id,
                status="found",
                dataset_name=DATASET_NAME,
                imported_at=imported_at,
                source_url=DATASET_URL,
                registry_record_id=record.id,
            )
        )
        _log(
            db,
            "imported_ashyq",
            obj.id,
            actor="ashyq_import",
            details={
                "source_id": source_record_id,
                "registry_record_id": record.id,
                "permission_number": mapped.get("permission_number"),
                "date_start": mapped.get("permission_start"),
                "date_end": mapped.get("permission_end"),
            },
        )
        accepted.append({"row_number": row_number, "status": "accepted", "object_id": obj.id})
    db.commit()
    return {
        "uploaded_rows": len(rows),
        "imported_objects": imported,
        "updated_objects": updated,
        "duplicates_skipped": duplicates,
        "accepted": accepted,
        "skipped": skipped,
        "dataset_name": DATASET_NAME,
        "source_url": DATASET_URL,
        "imported_at": imported_at.isoformat(),
        "message_code": "import_complete_no_r1",
    }


@router.post("/import/telegram", status_code=201)
async def import_telegram(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or Path(file.filename).name.lower() != "result.json":
        raise HTTPException(415, "telegram_result_json_required")
    raw = await file.read(5_000_001)
    if len(raw) > 5_000_000:
        raise HTTPException(413, "file_too_large")
    try:
        channel, messages = parse_telegram_export(raw)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    if len(messages) > 10000:
        raise HTTPException(413, "too_many_messages")
    imported = 0
    imported_items = []
    for message in messages:
        # Telegram export authors and phone numbers are deliberately discarded.
        publication = Publication(
            source=f"telegram:{channel}",
            source_url=message["source_url"],
            text=message["text"],
            published_at=message["published_at"],
            extraction={"telegram_channel": channel, "captured_at": _iso(datetime.now(timezone.utc))},
        )
        db.add(publication)
        db.flush()
        extraction = await extract_payment_offer(publication.text)
        publication.extraction.update(extraction.model_dump())
        imported += 1
        imported_items.append(
            {
                "publication_id": publication.id,
                "published_at": _iso(publication.published_at),
                "captured_at": _iso(publication.created_at),
                "source_url": publication.source_url,
                "text": publication.text,
                "extraction": extraction.model_dump(),
                "matches": matches(publication.text[:200], db),
            }
        )
    _log(
        db,
        "telegram_imported",
        entity_type="telegram_import",
        details={"channel": channel, "messages": imported},
    )
    db.commit()
    return {
        "channel": channel,
        "imported": imported,
        "captured_at": _iso(datetime.now(timezone.utc)),
        "messages": imported_items,
    }


@router.post("/objects/{object_id}/legal-check/ashyq")
def check_legal_basis_against_ashyq(object_id: int, db: Session = Depends(get_db)):
    obj = db.get(HousingObject, object_id)
    if not obj:
        raise HTTPException(404, "object_not_found")
    records = db.scalars(select(RegistryRecord).where(RegistryRecord.source_id == "ashyq")).all()

    def normalized(value: str | None) -> str:
        return "".join(char for char in (value or "").casefold() if char.isalnum())

    candidate = next(
        (
            record
            for record in records
            if record.housing_object_id == obj.id
            or (
                normalized(record.payload.get("name")) == normalized(obj.name)
                and normalized(record.payload.get("developer")) == normalized(obj.developer)
            )
        ),
        None,
    )
    dataset_loaded = bool(records)
    imported_at = (
        candidate.imported_at
        if candidate
        else max((record.imported_at for record in records), default=datetime.now(timezone.utc))
    )
    check = LegalBasisCheck(
        housing_object_id=obj.id,
        status="found" if candidate else "not_found" if dataset_loaded else "no_dataset",
        dataset_name=DATASET_NAME,
        imported_at=imported_at,
        source_url=candidate.source_url if candidate else DATASET_URL,
        registry_record_id=candidate.id if candidate else None,
    )
    db.add(check)
    _log(
        db,
        "legal_basis_dataset_check",
        obj.id,
        actor="ashyq_check",
        details={"status": check.status, "registry_record_id": check.registry_record_id},
    )
    db.commit()
    return {
        "status": check.status,
        "dataset_name": check.dataset_name,
        "imported_at": _iso(check.imported_at),
        "source_url": check.source_url,
        "registry_record_id": check.registry_record_id,
        "message_code": (
            "dataset_record_found"
            if candidate
            else "dataset_record_not_found_review_required"
            if dataset_loaded
            else "dataset_not_loaded_review_required"
        ),
    }


@router.get("/scenarios")
def scenarios():
    path = __import__("pathlib").Path(__file__).resolve().parents[2] / "seed" / "scenarios.json"
    return json.loads(path.read_text(encoding="utf-8"))


@router.post("/demo-seed")
def seed_demo_data():
    counts = load_demo_data()
    return {
        "message": "Загружены вымышленные контрольные данные с маркировкой ДЕМО.",
        **counts,
    }


@router.get("/signals")
def signals(db: Session = Depends(get_db)):
    rows = db.scalars(select(Signal).order_by(Signal.updated_at.desc())).all()
    return [
        {
            "id": s.id,
            "housing_object_id": s.housing_object_id,
            "object_name": s.housing_object.name,
            "is_demo": s.housing_object.is_demo,
            "status": s.status,
            "author": s.author,
            "comments": s.comments,
            "score_snapshot": s.score_snapshot,
            "updated_at": _iso(s.updated_at),
        }
        for s in rows
    ]


@router.post("/signals", status_code=201)
def create_signal(payload: SignalCreate, db: Session = Depends(get_db)):
    obj = db.get(HousingObject, payload.housing_object_id)
    if not obj:
        raise HTTPException(404, "Объект не найден")
    signal = Signal(
        housing_object_id=obj.id,
        author=router_actor.get(),
        comments=(
            [
                {
                    "author": router_actor.get(),
                    "text": payload.comment,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            ]
            if payload.comment
            else []
        ),
        score_snapshot=_score(obj),
    )
    db.add(signal)
    db.flush()
    _log(
        db,
        "signal_created",
        obj.id,
        "signal",
        signal.id,
        router_actor.get(),
        {"score": signal.score_snapshot.get("score")},
    )
    db.commit()
    return {"id": signal.id, "status": signal.status, "score_snapshot": signal.score_snapshot}


@router.patch("/signals/{signal_id}/status")
def transition_signal(signal_id: int, payload: SignalTransition, db: Session = Depends(get_db)):
    signal = db.get(Signal, signal_id)
    if not signal:
        raise HTTPException(404, "Сигнальная карточка не найдена")
    if payload.status not in ALLOWED_TRANSITIONS[signal.status]:
        raise HTTPException(409, f"Переход {signal.status} → {payload.status} запрещён")
    if payload.status == "confirmed" and not signal.score_snapshot.get("factors"):
        raise HTTPException(422, "Карточка без подтверждённых факторов не может быть утверждена")
    signal.status = payload.status
    signal.comments = [
        *signal.comments,
        {
            "author": router_actor.get(),
            "text": payload.comment,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    ]
    _log(
        db,
        "signal_status_changed",
        signal.housing_object_id,
        "signal",
        signal.id,
        router_actor.get(),
        {"status": payload.status, "comment": payload.comment},
    )
    db.commit()
    return {"id": signal.id, "status": signal.status, "comments": signal.comments}
