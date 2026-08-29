import { authorizeTipListener, json, listTipEvents } from './_tip-shared.js';

export async function onRequestGet({ request, env }) {
  const auth = authorizeTipListener(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!env.TIP_EVENTS) return json({ ok: false, error: 'Missing TIP_EVENTS KV binding.' }, 500);

  const url = new URL(request.url);
  const waitSeconds = Math.max(1, Math.min(25, Number.parseInt(url.searchParams.get('wait') || '25', 10)));
  const limit = Math.max(1, Math.min(25, Number.parseInt(url.searchParams.get('limit') || '10', 10)));
  const deadline = Date.now() + waitSeconds * 1000;

  do {
    const events = await listTipEvents(env, limit);
    if (events.length || Date.now() >= deadline) return json({ ok: true, mode: 'long-poll', events });
    await sleep(1000);
  } while (Date.now() < deadline);

  return json({ ok: true, mode: 'long-poll', events: [] });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
