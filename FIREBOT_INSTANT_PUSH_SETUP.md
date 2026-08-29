# Firebot Instant Push Setup for NoahGrove.com 1.64

This version is based on your uploaded `1.64.zip`.

It keeps the working Square/PayPal tip queue and adds an optional instant-push Worker:

Square/PayPal tip -> Cloudflare Pages queues the tip -> Pages publishes to Worker -> Mac listener receives WebSocket push -> Firebot preset runs.

The existing `/api/tip-events` queue remains the source of truth, so if the WebSocket drops, the Mac listener still polls as a fallback and acknowledges events after receiving them.

## 1. Deploy the website

From this project folder:

```bash
npm install
npm run deploy
```

## 2. Confirm your existing Pages secrets/bindings

Your Pages project still needs:

```bash
npx wrangler pages secret put TIP_LISTENER_SECRET --project-name noahgrovemusic
npx wrangler pages secret put SQUARE_ACCESS_TOKEN --project-name noahgrovemusic
npx wrangler pages secret put SQUARE_LOCATION_ID --project-name noahgrovemusic
npx wrangler pages secret put SQUARE_ENVIRONMENT --project-name noahgrovemusic
npx wrangler pages secret put SQUARE_WEBHOOK_SIGNATURE_KEY --project-name noahgrovemusic
npx wrangler pages secret put SQUARE_WEBHOOK_URL --project-name noahgrovemusic
npx wrangler pages secret put PAYPAL_CLIENT_ID --project-name noahgrovemusic
npx wrangler pages secret put PAYPAL_CLIENT_SECRET --project-name noahgrovemusic
npx wrangler pages secret put PAYPAL_ENVIRONMENT --project-name noahgrovemusic
```

You also still need the KV binding:

```text
TIP_EVENTS
```

## 3. Deploy the instant-push Worker

From this project folder:

```bash
cd tip-push-worker
npm install
npx wrangler deploy
```

Then set the same listener secret on the Worker:

```bash
npx wrangler secret put TIP_LISTENER_SECRET
```

Use the exact same value as your Pages `TIP_LISTENER_SECRET`.

Wrangler will show your Worker URL. It will look similar to:

```text
https://noah-tip-push.YOUR-WORKERS-SUBDOMAIN.workers.dev
```

Test it:

```bash
curl https://noah-tip-push.YOUR-WORKERS-SUBDOMAIN.workers.dev/health
```

Expected:

```json
{"ok":true,"service":"noah-tip-push"}
```

## 4. Connect the website to the push Worker

Set this Pages secret:

```bash
npx wrangler pages secret put TIP_PUSH_URL --project-name noahgrovemusic
```

Enter your Worker URL, for example:

```text
https://noah-tip-push.YOUR-WORKERS-SUBDOMAIN.workers.dev
```

Then redeploy the website:

```bash
cd ..
npm run deploy
```

## 5. Install the updated Mac listener

Copy this file from the project to your Mac listener folder:

```bash
cp tools/firebot-tip-listener.mjs ~/firebot-tip-listener/firebot-tip-listener.mjs
chmod +x ~/firebot-tip-listener/firebot-tip-listener.mjs
```

Edit your start script:

```bash
nano ~/firebot-tip-listener/start-listener.sh
```

Use this template, keeping your real secret:

```bash
#!/bin/bash

export TIP_SITE_URL="https://www.noahgrove.com"
export TIP_PUSH_URL="https://noah-tip-push.YOUR-WORKERS-SUBDOMAIN.workers.dev"
export TIP_LISTENER_SECRET="YOUR_REAL_SECRET"

export TIP_ACTION="firebot"
export FIREBOT_URL="http://localhost:7472/api/v1"

export FIREBOT_PRESET_1="6f9e0c61-ef69-40f0-ad16-aa3c7bd767be"
export FIREBOT_PRESET_5="5e4b87a7-0fe7-46c2-868d-fab35003ea0d"
export FIREBOT_PRESET_10="96aa2a4d-875a-435e-8afb-849381f44029"
export FIREBOT_PRESET_20="08314224-7aa9-4698-b491-1d7ebf60f05e"
export FIREBOT_PRESET_50="aef44407-e7e2-414f-a037-34f00a84d889"
export FIREBOT_PRESET_100="95a28989-f8a0-46f6-a105-325b244d583c"

# Poll fallback stays on, but much less often because WebSocket push handles the instant trigger.
export TIP_POLL_SECONDS="10"
export TIP_TRIGGER_DELAY_MS="650"

cd "$HOME/firebot-tip-listener"
/opt/homebrew/bin/node firebot-tip-listener.mjs
```

Save with Control+O, Enter, Control+X.

## 6. Restart the listener

```bash
launchctl unload ~/Library/LaunchAgents/com.noah.firebot-tip-listener.plist
launchctl load ~/Library/LaunchAgents/com.noah.firebot-tip-listener.plist
```

Confirm:

```bash
ps aux | grep firebot-tip-listener
```

## 7. Test

Make a $1 Square tip.

Expected:

1. Firebot triggers almost immediately.
2. The queue clears:

```bash
curl -H 'Authorization: Bearer YOUR_REAL_SECRET' https://www.noahgrove.com/api/tip-events
```

Expected:

```json
{"ok":true,"events":[]}
```

## Notes

- Do not expose Firebot directly to the internet.
- The Mac still connects outbound only.
- If the WebSocket disconnects, the listener reconnects automatically.
- If push fails, polling fallback still checks `/api/tip-events`.
