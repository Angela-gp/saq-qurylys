from pydantic import BaseModel, Field


class PaymentExtraction(BaseModel):
    has_payment_offer: bool
    payment_type: str | None = None
    amount: str | None = None
    quote: str | None = None
    confidence: float = Field(ge=0, le=1)
    reasoning: str
    quote_valid: bool = False
    reliable: bool = False
    mode: str = "rules"
