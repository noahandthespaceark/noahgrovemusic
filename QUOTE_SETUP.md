# Instant quote configuration

The calculator keeps the existing rates: $400/$600/$800/$1000/$1250 for
1–5 hours; first new song free, then $25; each extra setup $100; one-way
driving distance at $2/mile.

Production Cloudflare Pages settings for project noahgrovemusic:

- GOOGLE_MAPS_API_KEY: server-side secret in the existing Google Cloud project.
  Enable Places API (New) and Routes API, with billing and suitable API restrictions.
  Do not use a browser HTTP-referrer-restricted key for server REST requests.
- QUOTE_TRAVEL_ORIGIN: server-side departure address. Never return it in public JSON.
- Existing mail settings remain RESEND_API_KEY, QUOTE_TO_EMAIL, QUOTE_FROM_EMAIL.
- Existing optional GigDashboard integration settings are unchanged.

Do not commit secrets or paste them into chat. No new service/account is required.
Configure Cloudflare WAF rate limits for /api/quote-locations,
/api/quote-estimate and /api/send-quote, plus Google quotas/budget alerts.
The in-code per-isolate burst guard is best-effort, not a global quota.

Read /api/quote-config to check booleans without exposing keys or the origin.
Configured does not prove the key is authorized: test a venue search and a route.
The deployment logs list quote-related setting names only, never their values.

The server recalculates submitted pricing. Unavailable travel is null, not zero;
the page, confirmation, and lead record carry a subtotal plus explicit pending status.
Incomplete addresses can still be submitted for manual follow-up. No final booking
or availability guarantee is made. Provider outages never imply free travel.

Browser changes abort obsolete routes, guard stale responses, debounce suggestions,
reuse a route in memory when only package options change, and clear state on Reset.
Google attribution remains next to search. Supply Google terms/privacy links as
part of the website's public privacy/terms policy before enabling Places if absent.

Validation: node --test tests/*.test.mjs. Email/lead sends in tests are mocked;
do not send production test inquiries to real customers.
