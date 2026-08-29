# Outreach tracker setup

The `/outreach` page is intentionally locked until `OUTREACH_PASSWORD` exists in Cloudflare Pages.

## Required Cloudflare settings

1. In Cloudflare Dashboard, open the **noahgrovemusic** Pages project.
2. Go to **Settings → Environment variables** and add `OUTREACH_PASSWORD` with the password you want to use. Add it to Production (and Preview too if desired).
3. The outreach API will use the first available D1 binding in this order: `OUTREACH_DB`, `ANALYTICS_DB`, `DB`, `NOAH_ANALYTICS_DB`. The existing site already uses this binding pattern for analytics, so if `ANALYTICS_DB` is already bound, no second database is required.
4. Deploy the project. Visit `https://noahgrove.com/outreach`. On first successful login, the database tables are created automatically and all directory entries are seeded automatically.

## Data behavior

- Directory records live in `outreach_contacts`.
- Emails, calls, responses, conversations, meetings and notes are appended to `outreach_activity`; logging an interaction does not overwrite history.
- The page computes email/call/response/spoken counts and last activity automatically.
- Quick activity types automatically advance the overall status when appropriate. You can manually override status.
- Password is held in browser `sessionStorage`, so closing the browser session clears it.
- `/outreach` is marked `noindex,nofollow`; the API also sends `X-Robots-Tag: noindex, nofollow`.

## Automatic follow-up reminder emails

Version 1.92 adds automatic email reminders for `Next follow-up` dates. See `OUTREACH_REMINDERS_SETUP.md` for the one-time scheduled Worker setup. The website reuses the existing Resend email configuration and D1 outreach database.
