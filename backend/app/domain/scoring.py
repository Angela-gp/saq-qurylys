from __future__ import annotations

from typing import Any

WEIGHTS = {"R1": 35, "R2": 25, "R3": 10, "R4": 15, "R5": 10, "R6": 5}
TITLES = {
    "R1": "Отсутствие применимого правового основания",
    "R2": "Предложение внести деньги до договора",
    "R3": "Активная реклама строящегося объекта",
    "R4": "Подтверждённое коллективное обращение",
    "R5": "Расхождение заявленной и подтверждённой готовности",
    "R6": "Документированный простой или просрочка",
}


def readiness_gap(declared: float | None, verified: float | None) -> float | None:
    """Return the absolute readiness difference in percentage points, if both values exist."""
    if declared is None or verified is None:
        return None
    return abs(float(declared) - float(verified))


def has_readiness_mismatch(declared: float | None, verified: float | None) -> bool:
    gap = readiness_gap(declared, verified)
    return gap is not None and gap >= 20


def zone_for_score(score: int, has_r1: bool, has_r2: bool) -> tuple[str, str]:
    if score >= 60 and has_r1 and has_r2:
        return "red", "Красная · приоритетная сигнальная карточка"
    if score >= 25:
        return "yellow", "Жёлтая · углублённая ручная проверка"
    return "green", "Зелёная · плановый мониторинг"


def calculate_score(evidence: list[dict[str, Any]], legal_basis_status: str | None = None) -> dict[str, Any]:
    """Only human-confirmed evidence scores. Missing data is never treated as R1."""
    confirmed: dict[str, list[dict[str, Any]]] = {code: [] for code in WEIGHTS}
    needs_review: list[dict[str, Any]] = []
    for item in evidence:
        code, status = item.get("factor_code"), item.get("status", "unknown")
        if code in WEIGHTS and status in {"fact", "confirmed"}:
            confirmed[code].append(item)
        elif code in WEIGHTS and status in {
            "ai_hypothesis",
            "unknown",
            "not_checked",
            "no_data",
            "hypothesis",
        }:
            needs_review.append(
                {
                    "factor_code": code,
                    "reason": item.get("review_reason") or "Нужно подтверждение аналитика",
                    "evidence_id": item.get("id"),
                }
            )
    if legal_basis_status in {None, "not_checked", "no_data"} and not confirmed["R1"]:
        needs_review.append(
            {
                "factor_code": "R1",
                "reason": "Правовое основание не проверено или данных нет; это не подтверждает R1.",
            }
        )
    factors = []
    total = 0
    for code, items in confirmed.items():
        if not items:
            continue
        total += WEIGHTS[code]
        for index, item in enumerate(items):
            factors.append(
                {
                    "factor_code": code,
                    "title": TITLES[code],
                    "points": WEIGHTS[code] if index == 0 else 0,
                    "evidence_id": item.get("id"),
                    "quote": item.get("quote"),
                    "source_url": item.get("source_url"),
                    "source": item.get("source"),
                    "captured_at": item.get("captured_at"),
                }
            )
    score = min(100, total)
    has_r1, has_r2 = bool(confirmed["R1"]), bool(confirmed["R2"])
    zone, label = zone_for_score(score, has_r1, has_r2)
    return {
        "score": score,
        "zone": zone,
        "zone_label": label,
        "factors": factors,
        "needs_review": needs_review,
    }


def score_control_scenario(factors: list[str], legal_basis_status: str = "not_checked") -> dict[str, Any]:
    evidence = [
        {"id": code, "factor_code": code, "status": "fact", "source_url": "demo://scenario"}
        for code in factors
    ]
    return calculate_score(evidence, legal_basis_status)
