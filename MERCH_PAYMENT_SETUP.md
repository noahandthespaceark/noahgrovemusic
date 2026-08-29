# Merch checkout payment setup

The Support page merch checkout now supports these payment paths:

- PayPal checkout button
- Venmo through PayPal Checkout when the buyer/device/account is eligible
- Cash App Pay through Square Web Payments SDK
- Existing Square hosted checkout fallback button

## Cloudflare Pages environment variables

Add these in Cloudflare Pages → your site → Settings → Environment variables.

### Square / Cash App Pay

Required for Cash App Pay and the Square fallback checkout:

- `SQUARE_ACCESS_TOKEN` — Square production access token
- `SQUARE_LOCATION_ID` — Square location ID
- `SQUARE_APPLICATION_ID` — Square application ID for Web Payments SDK
- `SQUARE_ENVIRONMENT` — `production` for live, `sandbox` for testing

Optional:

- `MERCH_SUPPORT_EMAIL` — buyer support email shown in hosted Square checkout

### PayPal / Venmo

Required for PayPal and Venmo buttons:

- `PAYPAL_CLIENT_ID` — PayPal REST app client ID
- `PAYPAL_CLIENT_SECRET` — PayPal REST app secret
- `PAYPAL_ENVIRONMENT` — `production` for live, `sandbox` for testing

Venmo is rendered by the PayPal JavaScript SDK with Venmo funding enabled. The Venmo button only appears for eligible U.S. buyers/devices/accounts. If Venmo does not appear on a desktop browser, test on a mobile device with Venmo installed.

### Email notifications

The direct PayPal/Venmo and Cash App Pay flows send a paid-order email when payment succeeds if these existing variables are configured:

- `RESEND_API_KEY`
- `QUOTE_TO_EMAIL`
- `QUOTE_FROM_EMAIL`

The hosted Square fallback still sends the existing “checkout started” email. For truly paid Square hosted-checkout notifications, keep the Square webhook configured as described in `MERCH_SQUARE_SETUP.md`.

## Files changed / added

- `support.html`
- `support/index.html`
- `functions/api/merch-config.js`
- `functions/api/create-paypal-merch-order.js`
- `functions/api/capture-paypal-merch-order.js`
- `functions/api/create-square-merch-payment.js`
- `functions/api/_merch-shared.js`

## Testing checklist

1. Deploy with your environment variables set.
2. Add one item to the merch cart.
3. Open PLACE ORDER.
4. Confirm PayPal buttons load.
5. Confirm Cash App Pay button loads if Square Application ID and Location ID are valid.
6. Make a small sandbox test payment first if using sandbox credentials.
7. Confirm the order email arrives and the payment appears in the correct dashboard.

## Venmo eligibility hotfix note

The checkout now avoids a non-standard early `paypal.isFundingEligible()` check that could incorrectly hide Venmo before the PayPal button object ran its own `button.isEligible()` check. The PayPal SDK is loaded with `enable-funding=venmo`; if PayPal still reports `button.isEligible() = false` on a real mobile browser with Live credentials, the remaining issue is PayPal merchant/app eligibility rather than this site's checkout code.

## Update: real Cash App Pay vs Square Checkout

The green Cash App Pay button no longer opens Square's hosted card checkout. It now uses Square Web Payments SDK when `SQUARE_APPLICATION_ID`, `SQUARE_LOCATION_ID`, `SQUARE_ACCESS_TOKEN`, and `SQUARE_ENVIRONMENT` are configured.

The **Continue to Square Checkout** button remains the hosted Square card/Apple Pay/Google Pay fallback.

See `CASH_APP_PAY_SETUP.md` for the exact setup commands.
