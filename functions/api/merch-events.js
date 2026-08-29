import { authorizeTipListener, json } from './_tip-shared.js';
import { acknowledgeMerchEvents, listMerchEvents } from './_merch-firebot-shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = authorizeTipListener(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.TIP_EVENTS) return json({ ok: false, error: 'Missing TIP_EVENTS KV binding.' }, 500);

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(25, Number.parseInt(url.searchParams.get('limit') || '10', 10)));
  const events = await listMerchEvents(env, limit);
  return json({ ok: true, events });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = authorizeTipListener(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.TIP_EVENTS) return json({ ok: false, error: 'Missing TIP_EVENTS KV binding.' }, 500);

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  if (!ids.length) return json({ ok: false, error: 'No event ids provided.' }, 400);
  await acknowledgeMerchEvents(env, ids);
  return json({ ok: true, acknowledged: ids.length });
}
