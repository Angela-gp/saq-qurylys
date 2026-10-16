from __future__ import annotations

import re

from backend.app.ai.schemas import PaymentExtraction

RULES = [
    (
        "бронь",
        re.compile(
            r"(?:платн\w*\s+брон\w*|брон\w*\s+(?:за|через|с|по)\s+оплат\w*|ақылы\s+брон\w*|брондау\s+үшін\s+төлем\w*)",
            re.I,
        ),
    ),
    ("депозит", re.compile(r"(?:депозит\w*|депозитке|салым\w*)", re.I)),
    ("первоначальный взнос", re.compile(r"(?:первоначальн\w*\s+взнос\w*|бастапқы\s+жарн\w*)", re.I)),
    (
        "предоплата",
        re.compile(r"(?:предоплат\w*|алдын\s+ала\s+төлем\w*|аванс\w*|оплат\w*\s+до\s+договор\w*)", re.I),
    ),
    ("закрепление цены", re.compile(r"(?:закреп\w*\s+цен\w*|бағаны\s+бекіт\w*)", re.I)),
]
AMOUNT = re.compile(r"(?:\d[\d\s.,]{1,12}\s*(?:₸|тг\.?|теңге|тыс\.?\s*тг|млн\.?\s*тг))", re.I)


def validate_quote(result: PaymentExtraction, text: str) -> PaymentExtraction:
    valid = bool(result.quote and result.quote in text)
    result.quote_valid = valid
    result.reliable = not result.has_payment_offer or valid
    if result.has_payment_offer and not valid:
        result.confidence = 0
        result.reasoning = "Недостоверный ответ: дословный фрагмент не найден в исходном тексте."
    return result


def extract_rules(text: str) -> PaymentExtraction:
    for label, pattern in RULES:
        match = pattern.search(text)
        if not match:
            continue
        start, end = match.span()
        quote = text[max(0, start - 40) : min(len(text), max(end + 50, start + 24))].strip()
        amount = AMOUNT.search(text, max(0, start - 60), min(len(text), end + 100)) or AMOUNT.search(text)
        return validate_quote(
            PaymentExtraction(
                has_payment_offer=True,
                payment_type=label,
                amount=amount.group(0).strip() if amount else None,
                quote=quote,
                confidence=0.82,
                reasoning="Найдена формулировка оплаты или бронирования. Это гипотеза, не юридический вывод.",
                mode="rules",
            ),
            text,
        )
    return validate_quote(
        PaymentExtraction(
            has_payment_offer=False,
            confidence=0.57,
            reasoning="Правила не нашли ключевую формулировку. Это не подтверждает отсутствие предложения.",
            mode="rules",
        ),
        text,
    )
