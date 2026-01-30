<?php

namespace App\Http\Controllers;

use App\Services\StripeService;
use App\Models\Payment;
use Illuminate\Http\Request;

class PaymentController extends Controller
{
    protected StripeService $stripeService;

    public function __construct(StripeService $stripeService)
    {
        $this->stripeService = $stripeService;
    }

    public function checkout(Request $request)
    {
        $validated = $request->validate([
            'amount' => 'required|numeric|min:0.50',
            'currency' => 'required|string|size:3',
        ]);

        $session = $this->stripeService->createCheckoutSession($validated);
        return redirect($session->url);
    }

    public function handleWebhook(Request $request)
    {
        $payload = $request->getContent();
        $signature = $request->header('Stripe-Signature');

        $event = $this->stripeService->verifyWebhook($payload, $signature);

        if ($event->type === 'checkout.session.completed') {
            Payment::create([
                'stripe_id' => $event->data->object->id,
                'amount' => $event->data->object->amount_total / 100,
                'status' => 'completed',
            ]);
        }

        return response()->json(['status' => 'ok']);
    }
}
