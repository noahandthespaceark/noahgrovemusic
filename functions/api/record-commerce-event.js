import { recordCommerceEvent } from './_commerce-stats.js';
import { buildTipEvent, storeTipEvent, timingSafeEqual } from './_tip-shared.js';
import { buildMerchEvent, storeMerchEvent } from './_merch-firebot-shared.js';

export async function onRequestPost({ request, env }) {
  if (!env.COMMERCE_TRACKING_SECRET) return json({ ok: false, error: 'Missing COMMERCE_TRACKING_SECRET.' }, 500);
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!timingSafeEqual(given, env.COMMERCE_TRACKING_SECRET)) return json({ ok: false, error: 'Unauthorized.' }, 401);
  const body = await request.json().catch(() => ({}));
  const result = await recordCommerceEvent(env, body, request);
  const firebotResult = await queueExternalFirebotEvent(env, body).catch(error => ({ ok: false, error: error?.message || String(error) }));
  return json({ ...result, firebot: firebotResult }, result.ok ? 200 : 500);
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }


async function queueExternalFirebotEvent(env, body = {}) {
  const sourceSite = String(body.sourceSite || body.site || body.source_site || '').toLowerCase();
  const meta = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const wantsFirebot = sourceSite.includes('setbliss') || meta.trigger_firebot === 'true' || meta.trigger_firebot === true || meta.firebot_trigger || meta.firebot_event_type;
  if (!wantsFirebot) return { ok: false, skipped: true, reason: 'not_firebot_event' };
  if (!env.TIP_EVENTS) return { ok: false, skipped: true, reason: 'missing_tip_events_kv' };

  const kind = String(body.kind || body.type || '').toLowerCase().includes('merch') ? 'merch' : 'tip';
  const common = {
    id: body.id || body.paymentId || body.payment_id || body.orderId || body.order_id || body.referenceId || body.reference_id || crypto.randomUUID(),
    provider: body.provider || body.paymentMethod || meta.payment_method || 'external',
    amountCents: Number.isFinite(Number(body.amountCents)) ? Math.round(Number(body.amountCents)) : Math.round(Number(body.amount || 0) * 100),
    currency: body.currency || meta.currency || 'USD',
    paymentId: body.paymentId || body.payment_id || '',
    orderId: body.orderId || body.order_id || '',
    referenceId: body.referenceId || body.reference_id || '',
    receiptUrl: body.receiptUrl || body.receipt_url || '',
    metadata: { ...meta, source_project: sourceSite || 'external', bridged_to_main_firebot_queue: 'true' }
  };
  if (kind === 'merch') {
    await storeMerchEvent(env, buildMerchEvent(common));
    return { ok: true, queued: 'merch_purchase', queue: 'merch-events' };
  }
  await storeTipEvent(env, buildTipEvent(common));
  return { ok: true, queued: 'tip', queue: 'tip-events' };
}
