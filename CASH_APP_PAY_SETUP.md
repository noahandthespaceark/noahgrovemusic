# Cash App Pay setup for merch checkout

This project now separates two different Square flows:

- **Continue to Square Checkout**: opens Square's hosted checkout page, which can show card, Apple Pay, and Google Pay depending on the buyer/device.
- **Cash App Pay**: uses Square Web Payments SDK on NoahGrove.com, receives a one-time Cash App Pay token, and charges that token through the Cloudflare Function `/api/create-square-merch-payment`.

## Cloudflare secrets required

From the project folder, set these values for Cloudflare Pages:

```bash
npx wrangler pages secret put SQUARE_APPLICATION_ID --project-name noahgrovemusic
npx wrangler pages secret put SQUARE_LOCATION_ID --project-name noahgrovemusic
npx wrangler pages secret put SQUARE_ACCESS_TOKEN --project-name noahgrovemusic
npx wrangler pages secret put SQUARE_ENVIRONMENT --project-name noahgrovemusic
```

For live payments, use:

```text
production
```

For sandbox testing, use:

```text
sandbox
```

Important: the Application ID, Location ID, and Access Token must all come from the same Square environment. Do not mix sandbox and production values.

## Where to find the Square values

In the Square Developer Dashboard:

1. Open your Square app.
2. Choose **Production** for real payments, or **Sandbox** for testing.
3. Copy the **Application ID**.
4. Copy or create an **Access Token**.
5. Find your **Location ID** under the app/location settings.

## Deploy

After setting the secrets:

```bash
npm run deploy
```

## Testing

Open the merch checkout and look under **Pay with**:

- If Cash App Pay credentials are missing, it will show **Cash App Pay setup needed**.
- If Square Web Payments SDK loads successfully, it will render the real Square Cash App Pay button/flow.
- The separate **Continue to Square Checkout** button remains the hosted Square card checkout fallback.

Cash App Pay is only supported for eligible U.S. Square sellers/buyers. If it does not render after credentials are set, confirm the Square account and location are enabled for Cash App Pay and are based in the United States.
