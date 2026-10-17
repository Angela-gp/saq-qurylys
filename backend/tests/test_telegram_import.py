import json
from pathlib import Path

import pytest

from backend.app.adapters.telegram_import import parse_telegram_export


def test_telegram_sample_import_parses_public_posts_without_author_data():
    raw = (Path(__file__).parents[2] / "data" / "sample" / "telegram-result.json").read_bytes()
    channel, messages = parse_telegram_export(raw)
    assert channel == "Канал Құрылыс жаңалықтары"
    assert len(messages) == 2
    assert "депозит" in messages[0]["text"]
    assert messages[0]["source_url"] == "https://t.me/qurylys_sample_channel/101"
    assert all("author" not in message and "phone" not in message for message in messages)


@pytest.mark.parametrize("raw", [b"", b"not json"])
def test_telegram_empty_or_invalid_json_is_rejected(raw):
    try:
        parse_telegram_export(raw)
    except ValueError as error:
        assert str(error) == "invalid_telegram_json"
    else:
        raise AssertionError("invalid JSON was accepted")


def test_telegram_text_entities_forwarded_messages_and_non_posts():
    raw = json.dumps(
        {
            "name": "Fictional public channel",
            "public_username": "fictional_channel",
            "messages": [
                {"id": 1, "type": "service", "text": "service action"},
                {"id": 2, "type": "message", "text": ""},
                {"id": 3, "type": "message", "media_type": "sticker"},
                {
                    "id": 4,
                    "type": "message",
                    "forwarded_from": "A private person",
                    "text": [{"type": "bold", "text": "Deposit "}, "for booking", None],
                },
            ]
        }
    ).encode("utf-8")
    channel, messages = parse_telegram_export(raw)

    assert channel == "Fictional public channel"
    assert len(messages) == 1
    assert messages[0]["text"] == "Deposit for booking"
    assert messages[0]["source_url"] == "https://t.me/fictional_channel/4"
    assert "forwarded_from" not in messages[0]


def test_telegram_sample_import_creates_publications_and_discards_author_fields(test_client):
    sample = Path(__file__).parents[2] / "data" / "sample" / "telegram-result.json"
    response = test_client.post(
        "/api/import/telegram",
        files={"file": ("result.json", sample.read_bytes(), "application/json")},
    )
    assert response.status_code == 201
    assert response.json()["imported"] == 2
    assert len(response.json()["messages"]) == 2
    assert all(item["captured_at"] for item in response.json()["messages"])
    assert all(
        "author" not in str(item).lower() and "phone" not in str(item).lower()
        for item in response.json()["messages"]
    )


def test_telegram_import_rejects_invalid_json(test_client):
    response = test_client.post(
        "/api/import/telegram", files={"file": ("result.json", b"{", "application/json")}
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "invalid_telegram_json"
