"""Privacy-conscious parser for Telegram Desktop public-channel result.json exports."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(
            part if isinstance(part, str) else str(part.get("text", "")) if isinstance(part, dict) else ""
            for part in value
        )
    return ""


def parse_telegram_export(raw: bytes) -> tuple[str, list[dict]]:
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("invalid_telegram_json") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list):
        raise ValueError("invalid_telegram_export")
    channel = str(payload.get("name") or "Telegram")[:200]
    username = str(payload.get("public_username") or "").strip().lstrip("@")
    messages = []
    for entry in payload["messages"]:
        if not isinstance(entry, dict) or entry.get("type") != "message":
            continue
        text = _text(entry.get("text")).strip()
        if not text:
            continue
        try:
            published = datetime.fromtimestamp(int(entry["date_unixtime"]), tz=timezone.utc)
        except (KeyError, TypeError, ValueError, OSError):
            try:
                published = datetime.fromisoformat(str(entry["date"]).replace("Z", "+00:00"))
                if published.tzinfo is None:
                    published = published.replace(tzinfo=timezone.utc)
            except (KeyError, TypeError, ValueError):
                published = None
        message_id = entry.get("id")
        url = f"https://t.me/{username}/{message_id}" if username and message_id else None
        messages.append({"text": text[:20000], "published_at": published, "source_url": url})
    return channel, messages
