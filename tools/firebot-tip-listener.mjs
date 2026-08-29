#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SITE_URL = cleanUrl(process.env.TIP_SITE_URL || 'https://www.noahgrove.com');
const PUSH_URL = cleanUrl(process.env.TIP_PUSH_URL || '');
const SECRET = process.env.TIP_LISTENER_SECRET || '';
const ACTION = (process.env.TIP_ACTION || 'firebot').toLowerCase();
const FIREBOT_URL = cleanUrl(process.env.FIREBOT_URL || 'http://localhost:7472/api/v1');
const POLL_SECONDS = Math.max(2, Number.parseInt(process.env.TIP_POLL_SECONDS || (PUSH_URL ? '10' : '2'), 10));
const TRIGGER_DELAY_MS = Math.max(0, Number.parseInt(process.env.TIP_TRIGGER_DELAY_MS || '650', 10));
const DENOMINATIONS = [100, 50, 20, 10, 5, 1];

const FIREBOT_PRESETS = {
  1: process.env.FIREBOT_PRESET_1 || 'tip_1',
  5: process.env.FIREBOT_PRESET_5 || 'tip_5',
  10: process.env.FIREBOT_PRESET_10 || 'tip_10',
  20: process.env.FIREBOT_PRESET_20 || 'tip_20',
  50: process.env.FIREBOT_PRESET_50 || 'tip_50',
  100: process.env.FIREBOT_PRESET_100 || 'tip_100'
};

if (!SECRET) die('Missing TIP_LISTENER_SECRET. Set it to the same secret configured in Cloudflare Pages.');
if ((ACTION === 'firebot' || ACTION === 'preset') && !FIREBOT_URL) die('Missing FIREBOT_URL.');

console.log(`Listening for paid tip events from ${SITE_URL}`);
console.log(PUSH_URL ? `Instant push enabled: ${PUSH_URL}` : 'Instant push disabled; polling only.');
console.log(`Polling fallback: every ${POLL_SECONDS}s`);
console.log(`Action: ${ACTION}`);
console.log('Tip stacking: $100, $50, $20, $10, $5, $1. Example: $9 = $5 x1 + $1 x4.');
console.log('Use Ctrl+C to stop.');

const seenEventIds = new Set();
let processing = Promise.resolve();

if (PUSH_URL) connectPushStream();
startPollingLoop();

function enqueueEvents(events, source = 'unknown') {
  if (!Array.isArray(events) || !events.length) return;
  processing = processing
    .then(() => processEvents(events, source))
    .catch(error => console.error(`[${new Date().toLocaleTimeString()}] process error: ${error.message || error}`));
}

async function processEvents(events, source) {
  for (const event of events) {
    if (!event?.id) continue;

    if (seenEventIds.has(event.id)) {
      await acknowledge([event.id]).catch(() => {});
      continue;
    }

    seenEventIds.add(event.id);

    // ACK before Firebot so a local trigger/restart cannot replay paid tips forever.
    await acknowledge([event.id]);
    console.log(`Acknowledged ${event.id} (${source})`);

    const plan = normalizeTriggerPlan(event);
    console.log(`[${new Date().toLocaleTimeString()}] Tip paid: $${Number(event.amount || 0).toFixed(2)} (${event.provider || 'unknown'} / ${event.id})`);
    console.log(`Trigger plan: ${plan.map(item => `$${item.denomination} x${item.count}`).join(', ') || 'none'}`);
    await runTriggerPlan(event, plan);
  }
}

function connectPushStream() {
  if (typeof WebSocket === 'undefined') {
    console.error('This Node version has no built-in WebSocket. Install current Node with: brew install node');
    return;
  }

  const wsUrl = toWsUrl(`${PUSH_URL}/stream?secret=${encodeURIComponent(SECRET)}`);
  let ws;

  const open = () => {
    try {
      ws = new WebSocket(wsUrl);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] WebSocket start failed: ${error.message || error}`);
      setTimeout(open, 3000);
      return;
    }

    ws.addEventListener('open', () => {
      console.log(`[${new Date().toLocaleTimeString()}] Instant push connected.`);
    });

    ws.addEventListener('message', event => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type === 'tip_event' && data.event) enqueueEvents([data.event], 'push');
        if (data?.type === 'tip_events' && Array.isArray(data.events)) enqueueEvents(data.events, 'push');
      } catch (error) {
        console.error(`[${new Date().toLocaleTimeString()}] Bad push message: ${error.message || error}`);
      }
    });

    ws.addEventListener('close', () => {
      console.error(`[${new Date().toLocaleTimeString()}] Instant push disconnected; reconnecting...`);
      setTimeout(open, 3000);
    });

    ws.addEventListener('error', () => {
      try { ws.close(); } catch (_) {}
    });
  };

  open();
}

function startPollingLoop() {
  const tick = async () => {
    try {
      const events = await fetchEvents();
      enqueueEvents(events, 'poll');
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] poll error: ${error.message || error}`);
    } finally {
      setTimeout(tick, POLL_SECONDS * 1000);
    }
  };
  tick();
}

async function fetchEvents() {
  const response = await fetch(`${SITE_URL}/api/tip-events?limit=10`, {
    headers: { Authorization: `Bearer ${SECRET}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Tip events failed: ${response.status}`);
  return Array.isArray(data.events) ? data.events : [];
}

async function acknowledge(ids) {
  const response = await fetch(`${SITE_URL}/api/tip-events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Tip event acknowledge failed: ${response.status}`);
}

function normalizeTriggerPlan(event) {
  if (Array.isArray(event.triggerPlan) && event.triggerPlan.length) {
    return event.triggerPlan
      .map(item => ({ denomination: Number(item.denomination), count: Math.max(0, Number(item.count) || 0) }))
      .filter(item => DENOMINATIONS.includes(item.denomination) && item.count > 0);
  }

  let remaining = Math.max(0, Math.floor(Number(event.amount || 0) + 1e-9));
  const plan = [];
  for (const denomination of DENOMINATIONS) {
    const count = Math.floor(remaining / denomination);
    if (count > 0) {
      plan.push({ denomination, count });
      remaining -= denomination * count;
    }
  }
  return plan;
}

async function runTriggerPlan(event, plan) {
  if (ACTION === 'none' || ACTION === 'dry-run') return;
  for (const item of plan) {
    for (let i = 1; i <= item.count; i++) {
      await triggerOne(event, item.denomination, i, item.count);
      if (TRIGGER_DELAY_MS > 0) await sleep(TRIGGER_DELAY_MS);
    }
  }
}

async function triggerOne(event, denomination, triggerIndex, triggerCount) {
  const env = {
    ...process.env,
    TIP_AMOUNT: String(event.amount || ''),
    TIP_AMOUNT_CENTS: String(event.amountCents || ''),
    TIP_EVENT_ID: event.id || '',
    TIP_PROVIDER: event.provider || '',
    TIP_DENOMINATION: String(denomination),
    TIP_TRIGGER_INDEX: String(triggerIndex),
    TIP_TRIGGER_COUNT: String(triggerCount)
  };

  if (ACTION === 'firebot' || ACTION === 'preset') {
    const presetId = FIREBOT_PRESETS[denomination];
    if (!presetId) throw new Error(`Missing FIREBOT_PRESET_${denomination}.`);
    const response = await fetch(`${FIREBOT_URL}/effects/preset/${encodeURIComponent(presetId)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'tip_trigger',
        denomination,
        amount: event.amount,
        amountCents: event.amountCents,
        eventId: event.id,
        provider: event.provider,
        triggerIndex,
        triggerCount,
        event
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Firebot preset failed for $${denomination}: HTTP ${response.status} ${text}`);
    }
    return;
  }

  if (ACTION === 'webhook') {
    const url = process.env[`FIREBOT_WEBHOOK_URL_${denomination}`] || process.env.FIREBOT_WEBHOOK_URL || process.env.TIP_WEBHOOK_URL;
    if (!url) throw new Error(`Missing FIREBOT_WEBHOOK_URL_${denomination} or FIREBOT_WEBHOOK_URL.`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'tip_trigger',
        denomination,
        amount: event.amount,
        amountCents: event.amountCents,
        eventId: event.id,
        provider: event.provider,
        triggerIndex,
        triggerCount,
        event
      })
    });
    if (!response.ok) throw new Error(`Firebot webhook failed for $${denomination}: HTTP ${response.status}`);
    return;
  }

  if (ACTION === 'command') {
    const command = process.env[`TIP_COMMAND_${denomination}`] || process.env.TIP_COMMAND || '';
    if (!command) throw new Error(`Missing TIP_COMMAND_${denomination} or TIP_COMMAND.`);
    await execFileAsync('/bin/bash', ['-lc', command], { env });
    return;
  }

  if (ACTION === 'hotkey') {
    const hotkey = process.env[`TIP_HOTKEY_${denomination}`] || process.env.TIP_HOTKEY || 'control+shift+t';
    await triggerHotkey(hotkey);
    return;
  }

  throw new Error(`Unsupported TIP_ACTION: ${ACTION}`);
}

async function triggerHotkey(hotkey) {
  const parts = hotkey.toLowerCase().split('+').map(part => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) throw new Error('TIP_HOTKEY is invalid. Example: control+shift+t');
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

function toWsUrl(url) {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return parsed.toString();
}

function escapeAppleScript(value) { return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"'); }
function cleanUrl(value) { return String(value || '').replace(/\/+$/, ''); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function die(message) { console.error(message); process.exit(1); }
