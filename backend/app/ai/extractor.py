from __future__ import annotations

import json
import os

import httpx

from backend.app.ai.rules_extractor import extract_rules, validate_quote
from backend.app.ai.schemas import PaymentExtraction


async def extract_payment_offer(text: str) -> PaymentExtraction:
    api_key = os.getenv("AI_API_KEY", "").strip()
    if not api_key:
        return extract_rules(text)
    base_url = os.getenv("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("AI_MODEL", "gpt-4o-mini")
    prompt = (
        "Извлеки условия оплаты из объявления о новостройке на русском или казахском. "
        "Верни строго JSON: {has_payment_offer:boolean,payment_type:string|null,amount:string|null,"
        "quote:string|null,confidence:number,reasoning:string}. quote должен быть дословной "
        "подстрокой входного текста. Не делай юридических выводов."
    )
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "system", "content": prompt}, {"role": "user", "content": text}],
                },
            )
            response.raise_for_status()
            raw = response.json()["choices"][0]["message"]["content"]
            result = PaymentExtraction.model_validate(json.loads(raw))
            result.mode = "llm"
            return validate_quote(result, text)
    except Exception as error:
        result = extract_rules(text)
        result.reasoning = (
            f"LLM недоступна ({type(error).__name__}); включены локальные правила. {result.reasoning}"
        )
        return result
