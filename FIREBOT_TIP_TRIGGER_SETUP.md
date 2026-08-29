# Firebot Payment Trigger Setup

This version uses the safest livestream architecture:

1. Square / Cash App Pay / PayPal / Venmo confirms a real payment.
2. Cloudflare stores the completed payment in the `TIP_EVENTS` KV queue.
3. Your Mac runs `tools/firebot-tip-listener.mjs` while you are live.
4. The Mac listener keeps a long-poll connection open to Cloudflare at `/api/tip-stream` so new payments are picked up quickly.
5. The Mac listener triggers Firebot locally, then acknowledges the event so it will not repeat.

This avoids exposing Firebot to the public internet. Firebot stays local on your Mac.

## Trigger amount stacking

The listener uses these denominations:

```text
$100, $50, $20, $10, $5, $1
```

It stacks them like change-making:

```text
$9   = $5 x1 + $1 x4
$20  = $20 x1
$59  = $50 x1 + $5 x1 + $1 x4
$137 = $100 x1 + $20 x1 + $10 x1 + $5 x1 + $1 x2
```

## What is covered

Automatic Firebot events are queued for:

- Square tip checkout payments
- Square card payments connected to this site
- Cash App Pay through Square
- PayPal checkout payments through this site
- Venmo checkout payments through PayPal when PayPal renders Venmo as a funding source

Direct personal Cash App or Venmo handle/QR payments that happen outside this website still cannot reliably trigger Firebot because they do not send verified payment events to this Cloudflare project.

## Cloudflare setup

Create a KV namespace for pending tip/payment events:

```bash
npx wrangler kv namespace create TIP_EVENTS
```

In Cloudflare Pages, bind that KV namespace to this project with the binding name:

```text
TIP_EVENTS
```

Add these Pages environment variables/secrets:

```text
SQUARE_ACCESS_TOKEN=your Square access token
SQUARE_LOCATION_ID=your Square location id
SQUARE_ENVIRONMENT=production
SQUARE_WEBHOOK_SIGNATURE_KEY=your Square webhook signature key
SQUARE_WEBHOOK_URL=https://www.noahgrove.com/api/square-webhook

PAYPAL_CLIENT_ID=your PayPal live client id
PAYPAL_CLIENT_SECRET=your PayPal live secret
PAYPAL_ENVIRONMENT=live

TIP_LISTENER_SECRET=make-a-long-random-secret
```

Use `sandbox` instead of `production/live` only while testing with sandbox accounts.

## Square webhook setup

In the Square Developer Dashboard, set your webhook Notification URL to:

```text
https://www.noahgrove.com/api/square-webhook
```

Select these events:

```text
payment.created
payment.updated
refund.created
refund.updated
```

The code only queues completed payments, so extra pending payment updates will not fire your sounds.

## PayPal / Venmo setup

Your existing PayPal/Venmo checkout flow captures payments in `/api/capture-paypal-merch-order`. After capture is completed, it now also queues a Firebot payment event.

For PayPal dashboard webhooks, you can later add a separate PayPal webhook endpoint, but it is not required for the current on-site PayPal/Venmo checkout because this project captures the order itself.

## Mac listener setup with hotkeys

From the project folder on your Mac:

```bash
export TIP_SITE_URL="https://www.noahgrove.com"
export TIP_LISTENER_SECRET="the same long secret from Cloudflare"
export TIP_ACTION="hotkey"

export TIP_HOTKEY_1="control+shift+1"
export TIP_HOTKEY_5="control+shift+5"
export TIP_HOTKEY_10="control+shift+0"
export TIP_HOTKEY_20="control+shift+2"
export TIP_HOTKEY_50="control+shift+6"
export TIP_HOTKEY_100="control+shift+9"

node tools/firebot-tip-listener.mjs
```

Set Firebot hotkey triggers to match those six hotkeys.

macOS must allow your Terminal app to control the computer:

```text
System Settings → Privacy & Security → Accessibility
```

Enable your terminal app there.

## Mac listener setup with Firebot local webhook/API

If you create local Firebot webhook URLs for each amount, use:

```bash
export TIP_SITE_URL="https://www.noahgrove.com"
export TIP_LISTENER_SECRET="the same long secret from Cloudflare"
export TIP_ACTION="webhook"

export FIREBOT_WEBHOOK_URL_1="http://127.0.0.1:PORT/YOUR-1-DOLLAR-FIREBOT-WEBHOOK"
export FIREBOT_WEBHOOK_URL_5="http://127.0.0.1:PORT/YOUR-5-DOLLAR-FIREBOT-WEBHOOK"
export FIREBOT_WEBHOOK_URL_10="http://127.0.0.1:PORT/YOUR-10-DOLLAR-FIREBOT-WEBHOOK"
export FIREBOT_WEBHOOK_URL_20="http://127.0.0.1:PORT/YOUR-20-DOLLAR-FIREBOT-WEBHOOK"
export FIREBOT_WEBHOOK_URL_50="http://127.0.0.1:PORT/YOUR-50-DOLLAR-FIREBOT-WEBHOOK"
export FIREBOT_WEBHOOK_URL_100="http://127.0.0.1:PORT/YOUR-100-DOLLAR-FIREBOT-WEBHOOK"

node tools/firebot-tip-listener.mjs
```

The listener sends a JSON POST containing the payment amount, denomination, provider, and event id.

## Test mode

To test without triggering Firebot:

```bash
export TIP_ACTION="dry-run"
node tools/firebot-tip-listener.mjs
```

## Deploy

From the project folder:

```bash
npm run deploy
```

2026-05-30 fix: Firebot listener now acknowledges a tip event before triggering Firebot and remembers seen event IDs during the session. The server ACK endpoint also deletes acknowledged event payloads from KV. This prevents the same completed payment from replaying every few seconds if the local trigger step fails or restarts.
