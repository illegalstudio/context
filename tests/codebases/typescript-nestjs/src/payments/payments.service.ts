import { Injectable } from '@nestjs/common';

interface Payment {
  id: string;
  amount: number;
  currency: string;
  userId: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: Date;
}

@Injectable()
export class PaymentsService {
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

  async getPayment(id: string): Promise<Payment | undefined> {
    return this.payments.get(id);
  }

  async completePayment(id: string): Promise<Payment | undefined> {
    const payment = this.payments.get(id);
    if (payment && payment.status === 'pending') {
      payment.status = 'completed';
      return payment;
    }
    return undefined;
  }

  async failPayment(id: string): Promise<Payment | undefined> {
    const payment = this.payments.get(id);
    if (payment && payment.status === 'pending') {
      payment.status = 'failed';
      return payment;
    }
    return undefined;
  }
}
