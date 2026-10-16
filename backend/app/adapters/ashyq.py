from __future__ import annotations

from datetime import datetime, timezone

import httpx

from backend.app.adapters.base import SourceAdapter

DATASET_ID = "magda-ds-b80110e9-218a-42ba-b8c8-01fa5e4c82c8"
BASE = "https://ashyq.data.gov.kz/api/v0/registry-read-only/records/"


class AshyqAdapter(SourceAdapter):
    id = "ashyq"
    name = "Ashyq Data · объекты долевого строительства"
    url = f"https://ashyq.data.gov.kz/dataset/{DATASET_ID}"

    async def fetch(self, query: str | None = None) -> dict:
        fetched = datetime.now(timezone.utc).isoformat()
        try:
            async with httpx.AsyncClient(
                timeout=8, headers={"Accept": "application/json", "User-Agent": "SAQ-QURYLYS/1.0"}
            ) as client:
                response = await client.get(f"{BASE}{DATASET_ID}/aspects")
                response.raise_for_status()
                aspects = {item["id"]: item.get("data", {}) for item in response.json()}
                distribution_ids = aspects.get("dataset-distributions", {}).get("distributions", [])
                distributions = []
                for item_id in distribution_ids:
                    dist_response = await client.get(f"{BASE}{item_id}/aspects")
                    dist_response.raise_for_status()
                    dist = next(
                        (
                            entry.get("data", {})
                            for entry in dist_response.json()
                            if entry.get("id") == "dcat-distribution-strings"
                        ),
                        {},
                    )
                    distributions.append({"id": item_id, **dist})
            return {
                "id": self.id,
                "name": self.name,
                "url": self.url,
                "data": {"metadata": aspects.get("dcat-dataset-strings", {}), "distributions": distributions},
                "status": "available",
                "fetched_at": fetched,
                "message": None,
                "message_code": "source_metadata_available",
            }
        except (httpx.HTTPError, KeyError, ValueError):
            return {
                "id": self.id,
                "name": self.name,
                "url": self.url,
                "data": None,
                "status": "no_data",
                "fetched_at": fetched,
                "message": None,
                "message_code": "source_unavailable_no_risk",
            }
