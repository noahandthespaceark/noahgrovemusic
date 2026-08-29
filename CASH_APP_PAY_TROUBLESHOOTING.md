# Cash App Pay troubleshooting

This release changes Cash App Pay error handling so Square API rejections are shown in the checkout instead of being reported as a generic Cloudflare 502.

Required Cloudflare Pages secrets:

```bash
npx wrangler pages secret put SQUARE_APPLICATION_ID --project-name noahgrovemusic
npx wrangler pages secret put SQUARE_LOCATION_ID --project-name noahgrovemusic
npx wrangler pages secret put SQUARE_ACCESS_TOKEN --project-name noahgrovemusic
npx wrangler pages secret put SQUARE_ENVIRONMENT --project-name noahgrovemusic
```

For live payments, `SQUARE_ENVIRONMENT` should be:

```text
production
```

Make sure the Application ID, Location ID, and Access Token all come from the same Square environment. Do not mix sandbox Application ID with production access token or production Location ID.

If Cash App Pay still fails after deploying, run:

```bash
npx wrangler pages deployment tail --project-name noahgrovemusic
```

Then try the payment again and copy the Cash App Pay log/error.
