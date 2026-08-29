import { authorizeTipListener, getTipIndex, json, listTipEvents } from './_tip-shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = authorizeTipListener(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.TIP_EVENTS) return json({ ok: false, error: 'Missing TIP_EVENTS KV binding.' }, 500);

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(25, Number.parseInt(url.searchParams.get('limit') || '10', 10)));
  const waitSeconds = Math.max(0, Math.min(25, Number.parseInt(url.searchParams.get('wait') || '0', 10)));
  const deadline = Date.now() + waitSeconds * 1000;

  do {
    const events = await listTipEvents(env, limit);
    if (events.length || !waitSeconds || Date.now() >= deadline) return json({ ok: true, events });
    await sleep(1000);
  } while (Date.now() < deadline);

  return json({ ok: true, events: [] });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = authorizeTipListener(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.TIP_EVENTS) return json({ ok: false, error: 'Missing TIP_EVENTS KV binding.' }, 500);

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  if (!ids.length) return json({ ok: false, error: 'No event ids provided.' }, 400);

  const index = await getTipIndex(env);
  const remaining = index.filter(id => !ids.includes(id));
  await env.TIP_EVENTS.put('index', JSON.stringify(remaining));
  for (const id of ids) {
    await env.TIP_EVENTS.put(`acked:${id}`, String(Date.now()), { expirationTtl: 60 * 60 * 24 * 30 });
    await env.TIP_EVENTS.delete(`event:${id}`);
  }
  return json({ ok: true, acknowledged: ids.length });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
