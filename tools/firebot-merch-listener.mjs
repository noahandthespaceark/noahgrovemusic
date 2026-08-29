#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SITE_URL = cleanUrl(process.env.MERCH_SITE_URL || process.env.TIP_SITE_URL || 'https://www.noahgrove.com');
const SECRET = process.env.MERCH_LISTENER_SECRET || process.env.TIP_LISTENER_SECRET || '';
const ACTION = (process.env.MERCH_ACTION || 'firebot').toLowerCase();
const FIREBOT_URL = cleanUrl(process.env.FIREBOT_URL || 'http://localhost:7472/api/v1');
const POLL_SECONDS = Math.max(2, Number.parseInt(process.env.MERCH_POLL_SECONDS || '2', 10));
const FIREBOT_MERCH_PRESET = process.env.FIREBOT_MERCH_PRESET || 'merch_purchase';

if (!SECRET) die('Missing MERCH_LISTENER_SECRET or TIP_LISTENER_SECRET. Use the same secret configured in Cloudflare Pages.');
if ((ACTION === 'firebot' || ACTION === 'preset') && !FIREBOT_URL) die('Missing FIREBOT_URL.');

console.log(`Listening for completed merch purchases from ${SITE_URL}`);
console.log(`Polling: every ${POLL_SECONDS}s`);
console.log(`Action: ${ACTION}`);
console.log(`Merch Firebot preset: ${FIREBOT_MERCH_PRESET}`);
console.log('Use Ctrl+C to stop.');

const seenEventIds = new Set();
let processing = Promise.resolve();
startPollingLoop();

function enqueueEvents(events) {
  if (!Array.isArray(events) || !events.length) return;
  processing = processing
    .then(() => processEvents(events))
    .catch(error => console.error(`[${new Date().toLocaleTimeString()}] process error: ${error.message || error}`));
}

async function processEvents(events) {
  for (const event of events) {
    if (!event?.id || event.type !== 'merch_paid') continue;
    if (seenEventIds.has(event.id)) {
      await acknowledge([event.id]).catch(() => {});
      continue;
    }

    seenEventIds.add(event.id);
    await acknowledge([event.id]);
    console.log(`[${new Date().toLocaleTimeString()}] Merch purchased: $${Number(event.amount || 0).toFixed(2)} (${event.provider || 'unknown'} / ${event.id})`);
    await triggerMerchPurchase(event);
  }
}

function startPollingLoop() {
  const tick = async () => {
    try {
      const events = await fetchEvents();
      enqueueEvents(events);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] poll error: ${error.message || error}`);
    } finally {
      setTimeout(tick, POLL_SECONDS * 1000);
    }
  };
  tick();
}

async function fetchEvents() {
  const response = await fetch(`${SITE_URL}/api/merch-events?limit=10`, {
    headers: { Authorization: `Bearer ${SECRET}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Merch events failed: ${response.status}`);
  return Array.isArray(data.events) ? data.events : [];
}

async function acknowledge(ids) {
  const response = await fetch(`${SITE_URL}/api/merch-events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Merch event acknowledge failed: ${response.status}`);
}

async function triggerMerchPurchase(event) {
  if (ACTION === 'none' || ACTION === 'dry-run') return;

  if (ACTION === 'firebot' || ACTION === 'preset') {
    const response = await fetch(`${FIREBOT_URL}/effects/preset/${encodeURIComponent(FIREBOT_MERCH_PRESET)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'merch_purchase',
        amount: event.amount,
        amountCents: event.amountCents,
        eventId: event.id,
        provider: event.provider,
        event
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Firebot merch preset failed: HTTP ${response.status} ${text}`);
    }
    return;
  }

  if (ACTION === 'webhook') {
    const url = process.env.FIREBOT_MERCH_WEBHOOK_URL || process.env.FIREBOT_WEBHOOK_URL || '';
    if (!url) throw new Error('Missing FIREBOT_MERCH_WEBHOOK_URL or FIREBOT_WEBHOOK_URL.');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'merch_purchase', amount: event.amount, amountCents: event.amountCents, eventId: event.id, provider: event.provider, event })
    });
    if (!response.ok) throw new Error(`Firebot merch webhook failed: HTTP ${response.status}`);
    return;
  }

  if (ACTION === 'command') {
    const command = process.env.FIREBOT_MERCH_COMMAND || '';
    if (!command) throw new Error('Missing FIREBOT_MERCH_COMMAND.');
    await execFileAsync('/bin/bash', ['-lc', command], { env: { ...process.env, FIREBOT_EVENT_TYPE: 'merch_purchase', MERCH_EVENT_ID: event.id || '', MERCH_AMOUNT: String(event.amount || '') } });
    return;
  }

  if (ACTION === 'hotkey') {
    const hotkey = process.env.FIREBOT_MERCH_HOTKEY || 'control+shift+m';
    await triggerHotkey(hotkey);
    return;
  }

  throw new Error(`Unsupported MERCH_ACTION: ${ACTION}`);
}

async function triggerHotkey(hotkey) {
  const parts = hotkey.toLowerCase().split('+').map(part => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) throw new Error('FIREBOT_MERCH_HOTKEY is invalid. Example: control+shift+m');
  const modifiers = parts.map(toAppleModifier).filter(Boolean);
  const keyName = toAppleKey(key);
  const modifierText = modifiers.length ? ` using {${modifiers.join(', ')}}` : '';
  const script = `tell application "System Events" to keystroke "${escapeAppleScript(keyName)}"${modifierText}`;
  await execFileAsync('/usr/bin/osascript', ['-e', script]);
}

function toAppleModifier(value) {
  if (['cmd', 'command'].includes(value)) return 'command down';
  if (['ctrl', 'control'].includes(value)) return 'control down';
  if (['alt', 'option'].includes(value)) return 'option down';
  if (value === 'shift') return 'shift down';
  return '';
}

function toAppleKey(value) {
  const map = { space: ' ', plus: '+', minus: '-', equals: '=', return: '\r', enter: '\r', tab: '\t' };
  return map[value] || value.slice(0, 1);
}

function escapeAppleScript(value) { return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"'); }
function cleanUrl(value) { return String(value || '').replace(/\/+$/, ''); }
function die(message) { console.error(message); process.exit(1); }
