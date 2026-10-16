from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ObjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=300)
    developer: str = Field(default="", max_length=300)
    bin: str | None = Field(default=None, pattern=r"^\d{12}$")
    address: str = Field(default="", max_length=500)
    region: str = Field(default="", max_length=200)
    status: str = "unknown"
    readiness: float | None = Field(default=None, ge=0, le=100)
    declared_readiness: float | None = Field(default=None, ge=0, le=100)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class PublicationCreate(BaseModel):
    text: str = Field(min_length=10, max_length=20000)
    source: str = Field(default="manual", max_length=200)
    source_url: str | None = Field(default=None, max_length=1000)
    housing_object_id: int | None = None
    published_at: datetime | None = None


class PublicationLinkUpdate(BaseModel):
    housing_object_id: int


class EvidenceReview(BaseModel):
    status: Literal["fact", "rejected"]
    reviewer: str = Field(min_length=2, max_length=200)
    comment: str | None = Field(default=None, max_length=2000)
    source_url: str | None = Field(default=None, max_length=1000)


class EvidenceCreate(BaseModel):
    factor_code: Literal["R1", "R2", "R3", "R4", "R5", "R6"]
    quote: str | None = Field(default=None, max_length=4000)
    source: str = Field(min_length=2, max_length=200)
    source_url: str | None = Field(default=None, max_length=1000)
    rationale: str = Field(min_length=5, max_length=3000)


class LegalBasisUpdate(BaseModel):
    status: Literal["absent", "confirmed", "not_checked"]
    basis_type: str | None = Field(default=None, max_length=200)
    source_url: str | None = Field(default=None, max_length=1000)
    analyst: str = Field(min_length=2, max_length=200)
    note: str = Field(min_length=5, max_length=2000)

    @model_validator(mode="after")
    def requires_primary_source(self):
        if self.status in {"absent", "confirmed"} and not self.source_url:
            raise ValueError("Для подтверждённого статуса укажите ссылку на проверенный источник")
        if self.status == "confirmed" and not self.basis_type:
            raise ValueError("Укажите тип действующего разрешения или гарантии")
        return self


class SignalCreate(BaseModel):
    housing_object_id: int
    author: str = Field(min_length=2, max_length=200)
    comment: str = Field(default="", max_length=2000)


class SignalTransition(BaseModel):
    status: Literal["in_review", "confirmed", "returned"]
    author: str = Field(min_length=2, max_length=200)
    comment: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def returned_requires_comment(self):
        if self.status == "returned" and not self.comment.strip():
            raise ValueError("При возврате добавьте комментарий")
        return self
