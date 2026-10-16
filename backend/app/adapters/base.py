from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone


class SourceAdapter(ABC):
    name: str
    url: str

    @abstractmethod
    async def fetch(self, query: str | None = None) -> dict:
        raise NotImplementedError


def stub(name: str, url: str) -> dict:
    return {
        "name": name,
        "url": url,
        "data": None,
        "status": "not_configured",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "message": "Интеграция не подключена; требуется ручная проверка в источнике.",
    }
