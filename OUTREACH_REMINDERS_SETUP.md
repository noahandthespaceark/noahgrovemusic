# Automatic Outreach Follow-up Email Reminders

The outreach tracker now sends an email reminder at approximately **8:05 AM Eastern** on a contact's `Next follow-up` date. If multiple contacts are due on the same day, they are combined into one useful digest. Overdue contacts that have never had a reminder sent for their current follow-up date are also included.

A reminder includes the organization/person, priority, category, status, email, phone, directory contact information, location, best approach, why the opportunity fits, your notes, sensitivity notes, source URL, and up to six recent communication-history entries.

The system records `Follow-up reminder sent` in the contact's communication history. It will not send the same reminder repeatedly. If you change the Next follow-up date, that automatically arms a new reminder for the new date.

## Existing email settings reused

The Pages function reuses the site's existing Resend configuration:
- `RESEND_API_KEY`
- `QUOTE_TO_EMAIL` as the default reminder recipient
- `QUOTE_FROM_EMAIL` as the default sender

Optional overrides are supported:
- `OUTREACH_REMINDER_EMAIL`
- `OUTREACH_REMINDER_FROM_EMAIL`

## One-time setup

### 1. Add a shared reminder token to the Pages project
From the main website project folder:

```bash
npx wrangler pages secret put OUTREACH_REMINDER_TOKEN --project-name noahgrovemusic
```

Enter a long random value and save it somewhere temporarily. Then deploy the website:

```bash
npm run deploy
```

### 2. Deploy the scheduled reminder Worker
Open the included worker folder:

```bash
cd outreach-reminder-worker
npx wrangler secret put OUTREACH_REMINDER_TOKEN
```

When prompted, enter the **exact same token** used for the Pages secret.

Then deploy it:

```bash
npm run deploy
```

The Worker has two UTC cron checks (12:05 and 13:05 UTC). The Pages endpoint only acts when the local Charleston/New York time is 8 AM, so this automatically follows daylight-saving time.

## Behavior

- A browser does not need to be open.
- Each specific Next follow-up date generates at most one reminder.
- Changing a follow-up date resets the reminder state.
- Completed, Not interested, and archived entries do not generate reminders.
- Due contacts are combined into one email when several need attention the same morning.
