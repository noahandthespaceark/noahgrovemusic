export const TIP_DENOMINATIONS = [100, 50, 20, 10, 5, 1];

export function splitTipAmount(amount) {
  let remaining = Math.max(0, Math.floor(Number(amount || 0) + 1e-9));
  const triggers = [];
  for (const denomination of TIP_DENOMINATIONS) {
    const count = Math.floor(remaining / denomination);
    if (count > 0) {
      triggers.push({ denomination, count });
      remaining -= denomination * count;
    }
  }
  return triggers;
}

export function buildTipEvent({ id, provider, amountCents, currency = 'USD', paymentId = '', orderId = '', referenceId = '', receiptUrl = '', metadata = {} }) {
  const cents = Math.max(0, Math.round(Number(amountCents || 0)));
  const amount = cents / 100;
  return {
    id: String(id || crypto.randomUUID()),
    createdAt: new Date().toISOString(),
    provider: String(provider || 'unknown'),
    type: 'tip_paid',
    amountCents: cents,
    amount,
    currency,
    paymentId,
    orderId,
    referenceId,
    receiptUrl,
    metadata,
    triggerPlan: splitTipAmount(amount)
  };
}


export function buildMerchEvent({ id, provider, amountCents, currency = 'USD', paymentId = '', orderId = '', referenceId = '', receiptUrl = '', metadata = {} }) {
  const cents = Math.max(0, Math.round(Number(amountCents || 0)));
  return {
    id: String(id || crypto.randomUUID()),
    createdAt: new Date().toISOString(),
    provider: String(provider || 'unknown'),
    type: 'merch_paid',
    amountCents: cents,
    amount: cents / 100,
    currency,
    paymentId,
    orderId,
    referenceId,
    receiptUrl,
    metadata: {
      ...metadata,
      firebot_trigger: 'merch_purchase'
    },
    triggerPlan: [{ kind: 'merch_purchase', count: 1 }]
  };
}

export async function storeTipEvent(env, tipEvent) {
  if (!env.TIP_EVENTS) return { ok: false, skipped: true };
  const eventKey = `event:${tipEvent.id}`;
  const alreadyStored = await env.TIP_EVENTS.get(eventKey);
  if (alreadyStored) return { ok: true, duplicate: true };
  await env.TIP_EVENTS.put(eventKey, JSON.stringify(tipEvent), { expirationTtl: 60 * 60 * 24 * 30 });
  const index = await getTipIndex(env);
  if (!index.includes(tipEvent.id)) {
    index.unshift(tipEvent.id);
    await env.TIP_EVENTS.put('index', JSON.stringify(index.slice(0, 250)));
  }

  // Optional instant-push bridge. The KV queue remains the source of truth;
  // this only wakes a live Mac listener faster than polling.
  await publishTipEvent(env, tipEvent).catch(error => {
    console.log('TIP_PUSH_URL publish failed', error?.message || String(error));
  });

  return { ok: true };
}

export async function publishTipEvent(env, tipEvent) {
  if (!env.TIP_PUSH_URL || !env.TIP_LISTENER_SECRET) return { ok: false, skipped: true };
  const pushUrl = String(env.TIP_PUSH_URL).replace(/\/+$/, '') + '/publish';
  const response = await fetch(pushUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.TIP_LISTENER_SECRET}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ event: tipEvent })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`TIP_PUSH_URL returned ${response.status}: ${text}`);
  }
  return response.json().catch(() => ({ ok: true }));
}

export async function getTipIndex(env) {
  const raw = await env.TIP_EVENTS.get('index');
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export async function listTipEvents(env, limit = 10) {
  const index = await getTipIndex(env);
  const selected = index.slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
  const events = [];
  for (const id of selected) {
    const event = await env.TIP_EVENTS.get(`event:${id}`, { type: 'json' });
    if (event) events.push({ ...event, triggerPlan: event.triggerPlan || splitTipAmount(event.amount) });
  }
  return events;
}

export function authorizeTipListener(request, env) {
  if (!env.TIP_LISTENER_SECRET) return { ok: false, status: 500, error: 'Missing TIP_LISTENER_SECRET.' };
  const url = new URL(request.url);
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('secret') || '';
  if (!timingSafeEqual(given, env.TIP_LISTENER_SECRET)) return { ok: false, status: 401, error: 'Unauthorized.' };
  return { ok: true };
}

export function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
