from typing import Optional
from dataclasses import dataclass
from datetime import datetime


@dataclass
class Payment:
    id: str
    amount: float
    currency: str
    user_id: int
    status: str
    created_at: datetime


class PaymentService:
    def __init__(self):
        self._payments: dict[str, Payment] = {}

    def create_payment(self, amount: float, currency: str, user_id: int) -> Payment:
        payment_id = f"pay_{datetime.now().timestamp()}"
        payment = Payment(
            id=payment_id,
            amount=amount,
            currency=currency,
            user_id=user_id,
            status='pending',
            created_at=datetime.now()
        )
        self._payments[payment_id] = payment
        return payment

    def get_payment(self, payment_id: str) -> Optional[Payment]:
        return self._payments.get(payment_id)

    def complete_payment(self, payment_id: str) -> Optional[Payment]:
        payment = self._payments.get(payment_id)
        if payment and payment.status == 'pending':
            payment.status = 'completed'
            return payment
        return None

    def refund_payment(self, payment_id: str) -> Optional[Payment]:
        payment = self._payments.get(payment_id)
        if payment and payment.status == 'completed':
            payment.status = 'refunded'
            return payment
        return None
