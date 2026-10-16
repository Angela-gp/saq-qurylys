from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.database import Base


def now_utc():
    return datetime.now(timezone.utc)


class HousingObject(Base):
    __tablename__ = "housing_objects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(300), index=True)
    developer: Mapped[str] = mapped_column(String(300), default="")
    bin: Mapped[str | None] = mapped_column(String(12), index=True)
    address: Mapped[str] = mapped_column(String(500), default="")
    region: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(80), default="unknown")
    readiness: Mapped[float | None] = mapped_column(Float)
    declared_readiness: Mapped[float | None] = mapped_column(Float)
    legal_basis_status: Mapped[str] = mapped_column(String(30), default="not_checked")
    legal_basis_type: Mapped[str | None] = mapped_column(String(200))
    legal_source_url: Mapped[str | None] = mapped_column(String(1000))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    is_demo: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    evidence: Mapped[list["Evidence"]] = relationship(
        back_populates="housing_object", cascade="all, delete-orphan"
    )
    publications: Mapped[list["Publication"]] = relationship(
        back_populates="housing_object", cascade="all, delete-orphan"
    )


class Publication(Base):
    __tablename__ = "publications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    housing_object_id: Mapped[int | None] = mapped_column(ForeignKey("housing_objects.id"), index=True)
    source: Mapped[str] = mapped_column(String(200), default="manual")
    source_url: Mapped[str | None] = mapped_column(String(1000))
    text: Mapped[str] = mapped_column(Text)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    extraction: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    housing_object: Mapped[HousingObject | None] = relationship(back_populates="publications")


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    housing_object_id: Mapped[int] = mapped_column(ForeignKey("housing_objects.id"), index=True)
    publication_id: Mapped[int | None] = mapped_column(ForeignKey("publications.id"))
    factor_code: Mapped[str] = mapped_column(String(2), index=True)
    status: Mapped[str] = mapped_column(String(30), default="ai_hypothesis")
    quote: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(200), default="analyst")
    source_url: Mapped[str | None] = mapped_column(String(1000))
    rationale: Mapped[str] = mapped_column(Text, default="")
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    reviewed_by: Mapped[str | None] = mapped_column(String(200))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    housing_object: Mapped[HousingObject] = relationship(back_populates="evidence")


class Signal(Base):
    __tablename__ = "signals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    housing_object_id: Mapped[int] = mapped_column(ForeignKey("housing_objects.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    author: Mapped[str] = mapped_column(String(200), default="Аналитик")
    comments: Mapped[list] = mapped_column(JSON, default=list)
    score_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
    housing_object: Mapped[HousingObject] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    housing_object_id: Mapped[int | None] = mapped_column(ForeignKey("housing_objects.id"), index=True)
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(100))
    actor: Mapped[str] = mapped_column(String(200), default="Аналитик")
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
