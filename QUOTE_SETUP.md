# Instant quote configuration

The calculator keeps the existing rates: $400/$600/$800/$1000/$1250 for
1–5 hours; first new song free, then $25; each extra setup $100; one-way
driving distance at $2/mile.

Production Cloudflare Pages settings for project noahgrovemusic:

- GOOGLE_MAPS_API_KEY: server-side secret in the existing Google Cloud project.
  Enable Places API (New) and Routes API, with billing and suitable API restrictions.
  Do not use a browser HTTP-referrer-restricted key for server REST requests.
- QUOTE_TRAVEL_ORIGIN: server-side departure address. Never return it in public JSON.
- RESEND_API_KEY: existing server-side Resend secret (sending-only access is sufficient).
- QUOTE_FROM_EMAIL: verified Resend sender, optionally `Noah Grove Music <address>`.
  Falls back to legacy FROM_EMAIL, then `Noah Grove Music <noah@noahgrove.com>`.
- QUOTE_TO_EMAIL: owner inbox; falls back to legacy TO_EMAIL, then noah@noahgrove.com.
- QUOTE_REPLY_TO_EMAIL: optional reply address for customer confirmations; defaults
  to the owner inbox. Replies to owner notifications go to the customer instead.
- Explicit invalid addresses fail closed, rather than silently rerouting mail.
- Existing optional GigDashboard integration settings are unchanged.

GigDashboard lead capture requires GIGDASHBOARD_API_KEY and
GIGDASHBOARD_POSSIBLE_CLIENTS_URL (legacy GIGDASHBOARD_API_URL is also supported).
Use the HTTPS `/api/possible-clients` endpoint; a dashboard base URL is normalized
to that path. Surrounding whitespace is trimmed; invalid URLs/headers fail closed.
The key must match the existing key on GigDashboard. Never paste it into chat.
`/api/quote-lead-health` performs only a credentialed GET and reports safe status
codes. Reachable does not establish that a lead was saved. Each submitted lead
includes the stable quote reference as estimateId so GigDashboard can upsert it.
Only a JSON receipt containing the matching estimateId and saved prospect ID
counts as success; redirects, login HTML, empty receipts and failures do not.

Do not commit secrets or paste them into chat. No new service/account is required.
Configure Cloudflare WAF rate limits for /api/quote-locations,
/api/quote-estimate and /api/send-quote, plus Google quotas/budget alerts.
The in-code per-isolate burst guard is best-effort, not a global quota.

Read /api/quote-config to check booleans without exposing keys or the origin.
The emailConfiguration object reports address setting sources and safe issue codes;
ready means locally valid configuration, not verified delivery. Read-only
/api/quote-email-health checks whether the configured sender domain is verified
with Resend. It sends no email and returns no addresses, keys, or domain lists.
Sending-only keys may return read_scope_unavailable; do not broaden permissions
just for this diagnostic. Sender verification still does not prove inbox delivery.
After changing Cloudflare production settings, redeploy to activate them.

Owner email must be accepted before attempting the customer confirmation. A
confirmation failure does not turn an accepted owner request into a failed inquiry.
Responses distinguish accepted, rejected, and unknown outcomes; raw provider
messages and lead response bodies are never exposed. Provider redirects are blocked.
Both emails include an itemized estimate, event details and a stable request reference.
Resend idempotency keys protect identical retries within its 24-hour retention
window, not forever. Do not automatically retry uncertain deliveries; contact Noah
with the reference before resubmitting. This is not durable exactly-once storage.
No customer or owner inbox delivery is claimed solely from provider acceptance.
Failed venue and route responses include a diagnostic with a fixed operation,
failure stage, HTTP status (when received), and allowlisted Google status/reason.
Raw Google messages, metadata, URLs, keys, addresses and stack traces are never
returned or logged. Unknown values are replaced with generic classifications.
Runtime setup, network/timeout, JSON parsing and no-route failures are distinct.
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
