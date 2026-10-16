from backend.app.ai.rules_extractor import extract_rules, validate_quote
from backend.app.ai.schemas import PaymentExtraction


def test_russian_offer_keeps_exact_quote():
    text = "Забронируйте квартиру, внесите депозит 100 000 тенге до подписания договора."
    result = extract_rules(text)
    assert result.has_payment_offer
    assert result.quote in text
    assert result.quote_valid


def test_kazakh_offer_detected():
    text = "Пәтерді брондау үшін бастапқы жарна төлеңіз."
    result = extract_rules(text)
    assert result.has_payment_offer
    assert result.quote in text


def test_ordinary_text_is_not_payment_offer():
    result = extract_rules("Жаңа үйдің құрылыс барысы мен жоспарлар туралы кеңес.")
    assert not result.has_payment_offer


def test_llm_quote_must_exist_verbatim_in_input():
    result = PaymentExtraction(
        has_payment_offer=True,
        quote="вымышленный фрагмент",
        confidence=0.9,
        reasoning="hypothesis",
        mode="llm",
    )
    checked = validate_quote(result, "Внесите депозит перед подписанием.")
    assert not checked.quote_valid
    assert not checked.reliable
    assert checked.confidence == 0
