# Merch Square checkout setup

This project now includes a Square-hosted merch checkout flow for the Support page.

## Required Cloudflare Pages environment variables

Add these in Cloudflare Pages → your site → Settings → Environment variables:

- `SQUARE_ACCESS_TOKEN` — your Square production access token
- `SQUARE_LOCATION_ID` — your Square location ID
- `SQUARE_ENVIRONMENT` — use `production` for the live site; use `sandbox` only for testing with sandbox credentials

The checkout function also uses your existing Resend email variables when available:

- `RESEND_API_KEY`
- `QUOTE_TO_EMAIL`
- `QUOTE_FROM_EMAIL`

Optional:

- `MERCH_SUPPORT_EMAIL` — shown to buyers in Square checkout; falls back to `QUOTE_TO_EMAIL` or `noah@noahgrove.com`

## Paid-order notification webhook

The checkout form sends a “checkout started” email when a buyer opens Square checkout. For a true “paid order” email, create a Square webhook:

- URL: `https://www.noahgrove.com/api/square-webhook`
- Events: payment updated / payment created events that include completed payments

Then add these Cloudflare environment variables:

- `SQUARE_WEBHOOK_SIGNATURE_KEY` — from the Square webhook settings
- `SQUARE_WEBHOOK_URL` — exactly `https://www.noahgrove.com/api/square-webhook`

Square should also show the order/payment in your Square Dashboard, and you can enable Square’s own payment notification emails there as a backup.

## PayPal, Venmo, and Cash App Pay

See `MERCH_PAYMENT_SETUP.md` for the newer multi-payment merch checkout setup.
