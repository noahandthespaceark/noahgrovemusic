# Firebot Merch Purchase Trigger

This project now keeps merch purchase events separate from tip events.

- The existing tip listener remains `tools/firebot-tip-listener.mjs`.
- The merch-only listener is `tools/firebot-merch-listener.mjs`.
- Merch events are stored under separate KV keys and are read from `/api/merch-events`.
- The tip listener reads `/api/tip-events`, so merch purchases should not trigger tip effects.

## Firebot setup

Create a Firebot preset effect named:

```txt
merch_purchase
```

Or set a custom preset id when starting the listener:

```bash
export FIREBOT_MERCH_PRESET="your_preset_id"
```

## Start the merch listener on your Mac

Use the same listener secret you already configured for the tip listener:

```bash
export TIP_LISTENER_SECRET="your_existing_secret"
export MERCH_SITE_URL="https://www.noahgrove.com"
export FIREBOT_URL="http://localhost:7472/api/v1"
export FIREBOT_MERCH_PRESET="merch_purchase"
node tools/firebot-merch-listener.mjs
```

Leave your existing tip listener exactly as-is. Run this merch listener as a second process/window.

## Optional actions

By default, `MERCH_ACTION` is `firebot`. Other supported options:

```bash
export MERCH_ACTION="webhook"
export FIREBOT_MERCH_WEBHOOK_URL="https://..."
```

```bash
export MERCH_ACTION="hotkey"
export FIREBOT_MERCH_HOTKEY="control+shift+m"
```

```bash
export MERCH_ACTION="command"
export FIREBOT_MERCH_COMMAND="your shell command"
```

## Merch receipts and Square receipt item names

This project version stores each Square hosted-checkout merch order in the `TIP_EVENTS` KV namespace for up to 30 days. When Square sends the completed payment webhook, the site looks up the original order and sends a polished merch receipt to:

- the customer email entered on the website checkout form
- Noah at the configured admin email (`QUOTE_TO_EMAIL`, normally `noah@noahgrove.com`)

The same item summary is also sent to Square as the hosted-checkout item name, so Square receipts should show the purchased merch item(s) instead of only a generic `NoahGrove.com merch order` label.

Required for automatic Square customer receipts:

- `RESEND_API_KEY`
- `QUOTE_FROM_EMAIL`
- `QUOTE_TO_EMAIL` set to `noah@noahgrove.com`
- `TIP_EVENTS` KV binding available to the Pages Functions
- Square webhook pointed to `/api/square-webhook` and configured for completed payment events

If Square's receipt still shows Noah's private/home address, that comes from Square account/location receipt settings, not this website code. Update the customer-facing Square business location/receipt address in the Square Dashboard.
