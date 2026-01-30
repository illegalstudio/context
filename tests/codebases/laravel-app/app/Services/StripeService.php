<?php

namespace App\Services;

use Stripe\Stripe;
use Stripe\Checkout\Session;
use Stripe\Webhook;
use Stripe\Exception\SignatureVerificationException;

class StripeService
{
    public function __construct()
    {
        Stripe::setApiKey(config('services.stripe.secret'));
    }

    public function createCheckoutSession(array $data): Session
    {
        return Session::create([
            'payment_method_types' => ['card'],
            'line_items' => [[
                'price_data' => [
                    'currency' => $data['currency'],
                    'product_data' => [
                        'name' => 'Payment',
                    ],
                    'unit_amount' => $data['amount'] * 100,
                ],
                'quantity' => 1,
            ]],
            'mode' => 'payment',
            'success_url' => config('app.url') . '/payment/success',
            'cancel_url' => config('app.url') . '/payment/cancel',
        ]);
    }

    public function verifyWebhook(string $payload, string $signature)
    {
        try {
            return Webhook::constructEvent(
                $payload,
                $signature,
                config('services.stripe.webhook_secret')
            );
        } catch (SignatureVerificationException $e) {
            throw new \Exception('Invalid webhook signature');
        }
    }
}
