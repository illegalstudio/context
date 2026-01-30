import { Router, Request, Response } from 'express';
import { PaymentService } from '../services/PaymentService.js';

const router = Router();
const paymentService = new PaymentService();

// POST /api/payments
router.post('/', async (req: Request, res: Response) => {
  try {
    const { amount, currency, userId } = req.body;
    const payment = await paymentService.createPayment(amount, currency, userId);
    res.status(201).json(payment);
  } catch (error) {
    res.status(400).json({ error: 'Payment failed' });
  }
});

// GET /api/payments/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const payment = await paymentService.getPayment(req.params.id);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
});

// POST /api/payments/webhook
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    await paymentService.handleWebhook(req.body);
    res.json({ received: true });
  } catch (error) {
    res.status(400).json({ error: 'Webhook processing failed' });
  }
});

export { router as paymentRoutes };
