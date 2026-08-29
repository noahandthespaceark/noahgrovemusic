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
    }
  };
}

export async function storeMerchEvent(env, merchEvent) {
  if (!env.TIP_EVENTS) return { ok: false, skipped: true };
  const eventKey = `merch:event:${merchEvent.id}`;
  const alreadyStored = await env.TIP_EVENTS.get(eventKey);
  if (alreadyStored) return { ok: true, duplicate: true };
  await env.TIP_EVENTS.put(eventKey, JSON.stringify(merchEvent), { expirationTtl: 60 * 60 * 24 * 30 });
  const index = await getMerchIndex(env);
  if (!index.includes(merchEvent.id)) {
    index.unshift(merchEvent.id);
    await env.TIP_EVENTS.put('merch:index', JSON.stringify(index.slice(0, 250)));
  }
  return { ok: true };
}

export async function getMerchIndex(env) {
  const raw = await env.TIP_EVENTS.get('merch:index');
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export async function listMerchEvents(env, limit = 10) {
  const index = await getMerchIndex(env);
  const selected = index.slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
  const events = [];
  for (const id of selected) {
    const event = await env.TIP_EVENTS.get(`merch:event:${id}`, { type: 'json' });
    if (event) events.push(event);
  }
  return events;
}

export async function acknowledgeMerchEvents(env, ids) {
  const index = await getMerchIndex(env);
  const remaining = index.filter(id => !ids.includes(id));
  await env.TIP_EVENTS.put('merch:index', JSON.stringify(remaining));
  for (const id of ids) {
    await env.TIP_EVENTS.put(`merch:acked:${id}`, String(Date.now()), { expirationTtl: 60 * 60 * 24 * 30 });
    await env.TIP_EVENTS.delete(`merch:event:${id}`);
  }
}
