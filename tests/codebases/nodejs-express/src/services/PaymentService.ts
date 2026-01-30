interface Payment {
  id: string;
  amount: number;
  currency: string;
  userId: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: Date;
}

interface WebhookPayload {
  type: string;
  data: {
    paymentId: string;
    status: string;
  };
}

export class PaymentService {
  private payments: Map<string, Payment> = new Map();

  async createPayment(amount: number, currency: string, userId: string): Promise<Payment> {
    const payment: Payment = {
      id: `pay_${Date.now()}`,
      amount,
      currency,
      userId,
      status: 'pending',
      createdAt: new Date(),
    };

    this.payments.set(payment.id, payment);
    return payment;
  }

  async getPayment(id: string): Promise<Payment | null> {
    return this.payments.get(id) || null;
  }

  async handleWebhook(payload: WebhookPayload): Promise<void> {
    if (payload.type === 'payment.completed') {
      const payment = this.payments.get(payload.data.paymentId);
      if (payment) {
        payment.status = 'completed';
      }
    } else if (payload.type === 'payment.failed') {
      const payment = this.payments.get(payload.data.paymentId);
      if (payment) {
        payment.status = 'failed';
      }
    }
  }

  async refundPayment(id: string): Promise<Payment | null> {
    const payment = this.payments.get(id);
    if (!payment || payment.status !== 'completed') {
      return null;
    }

    // In real implementation, would call payment provider API
    payment.status = 'failed'; // Using failed as refunded for simplicity
    return payment;
  }
}
