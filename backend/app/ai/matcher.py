from __future__ import annotations

import re

from rapidfuzz import fuzz


def suggest_matches(query: str, objects: list[dict], limit: int = 5) -> list[dict]:
    norm_query = re.sub(r"[^\w\s]", " ", query.lower().replace("ё", "е"))
    tokens = [
        token for token in norm_query.split() if len(token) > 2 and token not in {"жилой", "комплекс", "дом"}
    ]
    suggestions = []
    for obj in objects:
        target = (
            " ".join(str(obj.get(key) or "") for key in ("name", "address", "developer"))
            .lower()
            .replace("ё", "е")
        )
        if not target.strip():
            continue
        token_ratio = sum(1 for token in tokens if token in target) / max(1, len(tokens))
        confidence = min(0.99, 0.22 * fuzz.token_set_ratio(norm_query, target) / 100 + 0.78 * token_ratio)
        if confidence >= 0.12:
            suggestions.append(
                {
                    "object_id": obj["id"],
                    "name": obj.get("name"),
                    "address": obj.get("address"),
                    "confidence": round(confidence, 2),
                    "reason": "Совпадение названия, адреса или застройщика",
                }
            )
    return sorted(suggestions, key=lambda item: item["confidence"], reverse=True)[:limit]
