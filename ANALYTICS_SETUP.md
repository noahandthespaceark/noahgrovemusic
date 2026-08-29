# NoahGrove.com Stats Dashboard Setup

This project now includes a private stats dashboard at `/stats/` and `/stats.html`.

## What was added

- `analytics.js` tracks page views, support/tip clicks, outbound music/social clicks, YouTube embed plays/progress, and sticky-player events.
- `/api/track` stores events in Cloudflare D1.
- `/api/stats` reads dashboard summaries.
- `/stats/` displays visits, visitors, song plays, downloads, YouTube engagement, referrers, devices, countries, and recent activity.

## Required Cloudflare setup

Create a D1 database and bind it to this Pages project as:

```txt
ANALYTICS_DB
```

Recommended database name:

```txt
noahgrove-analytics
```

You do not have to manually run SQL. The functions create the analytics table and indexes automatically on first use.

## Password protection

Add a Cloudflare Pages environment variable:

```txt
STATS_PASSWORD=your-private-password
```

If `STATS_PASSWORD` is not set, the dashboard will still work, but it will warn you that the stats page is open.

## Deploy

```bash
npm run deploy
```

Then visit:

```txt
https://noahgrove.com/stats/
```

## Notes

Analytics starts collecting after this version is deployed. Past visits/downloads/plays cannot be reconstructed unless you already have logs elsewhere.

## Commerce stats: tips and merch

This version records completed tips and merch sales into the existing `analytics_events` D1 table with event types `tip_paid` and `merch_paid`.

Tracked automatically on noahgrove.com:
- Square support-page tips after the Square webhook confirms payment completion.
- Square merch checkouts after the Square webhook confirms payment completion.
- Cash App Pay / Square Web Payments SDK merch payments after the server-side payment completes.
- PayPal / Venmo support-page tips after capture completes.
- PayPal / Venmo merch payments after capture completes.

For SetBliss request-page tips and merch to appear in this noahgrove.com stats page:
1. Deploy the included SetBliss companion update.
2. Set the same `COMMERCE_TRACKING_SECRET` value in both Cloudflare Pages projects.
3. In SetBliss, set `MAIN_STATS_COMMERCE_URL` to `https://noahgrove.com`.

The main site exposes `POST /api/record-commerce-event`, protected by `COMMERCE_TRACKING_SECRET`, for SetBliss to report completed request-page tips and merch sales.
