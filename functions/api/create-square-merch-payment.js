import { json, parseAndValidateOrder, dollarsToCents, summarizeItems, buildBuyerNote, sendMerchReceiptEmails } from './_merch-shared.js';
import { buildMerchEvent, storeMerchEvent } from './_merch-firebot-shared.js';
import { commercePayloadFromMerchEvent, recordCommerceEvent } from './_commerce-stats.js';

export async function onRequestPost({ request, env }) {
  try {
    if (!env.SQUARE_ACCESS_TOKEN) return json({ ok: false, error: 'Missing SQUARE_ACCESS_TOKEN. Add your Square access token as a Cloudflare Pages secret.' }, 500);
    if (!env.SQUARE_LOCATION_ID) return json({ ok: false, error: 'Missing SQUARE_LOCATION_ID. Add your Square location ID as a Cloudflare Pages secret.' }, 500);
    const body = await request.json();
    const sourceId = String(body.sourceId || '').trim();
    if (!sourceId) return json({ ok: false, error: 'Missing Square payment token.' }, 400);
    const order = parseAndValidateOrder(body);
    const squareBase = env.SQUARE_ENVIRONMENT === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
    const paymentPayload = {
      idempotency_key: crypto.randomUUID(),
      source_id: sourceId,
      amount_money: { amount: dollarsToCents(order.total), currency: 'USD' },
      location_id: env.SQUARE_LOCATION_ID,
      reference_id: order.referenceId,
      note: buildBuyerNote(order).slice(0, 500),
      buyer_email_address: String(order.email || '').trim(),
      autocomplete: true,
      metadata: {
        source: 'noahgrove.com merch cash app pay',
        trigger_firebot: 'true',
        firebot_event_type: 'merch_purchase',
        delivery_method: order.deliveryMethod,
        order_summary: summarizeItems(order.cartItems).slice(0, 490),
        customer_name: String(order.fullName || '').slice(0, 60),
        customer_phone: String(order.phone || '').slice(0, 40)
      }
    };
    if (body.verificationToken) paymentPayload.verification_token = String(body.verificationToken);
    const res = await fetch(`${squareBase}/v2/payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'Square-Version': '2026-05-20' },
      body: JSON.stringify(paymentPayload)
    });
    const rawText = await res.text();
    let data = {};
    try { data = rawText ? JSON.parse(rawText) : {}; } catch (_) { data = { raw: rawText }; }
    if (!res.ok) {
      const firstError = data?.errors?.[0] || {};
      const detail = firstError.detail || firstError.field || firstError.code || rawText || 'Square rejected the payment request.';
      return json({
        ok: false,
        error: `Square rejected the Cash App Pay payment: ${detail}`,
        squareStatus: res.status,
        squareCategory: firstError.category || '',
        squareCode: firstError.code || '',
        details: data
      }, 400);
    }
    const status = data?.payment?.status || '';
    if (!['COMPLETED', 'APPROVED'].includes(status)) {
      return json({ ok: false, error: `Square created the payment but returned status: ${status || 'unknown'}.`, squareStatus: res.status, details: data }, 400);
    }
    await queueSquareMerchFirebotEvent(data?.payment || {}, order, env);
    await sendMerchReceiptEmails({ ...order, paymentMethod: 'Cash App Pay' }, env, { method: 'Cash App Pay' });
    return json({ ok: true, status, referenceId: order.referenceId });
  } catch (error) {
    console.error('create-square-merch-payment failed', error);
    return json({ ok: false, error: error?.message || 'Unexpected Cash App Pay server error.' }, 500);
  }
}

async function queueSquareMerchFirebotEvent(payment, order, env) {
  if (!env.TIP_EVENTS) return;
  const merchEvent = buildMerchEvent({
    id: payment?.id || order.referenceId || crypto.randomUUID(),
    provider: 'square_cash_app_pay',
    amountCents: payment?.amount_money?.amount || dollarsToCents(order.total),
    currency: payment?.amount_money?.currency || 'USD',
    paymentId: payment?.id || '',
    orderId: payment?.order_id || '',
    referenceId: order.referenceId || '',
    receiptUrl: payment?.receipt_url || '',
    metadata: {
      source: 'noahgrove.com merch cash app pay',
      payment_method: 'Cash App Pay',
      delivery_method: order.deliveryMethod || '',
      order_summary: summarizeItems(order.cartItems),
      customer_name: order.fullName || '',
      customer_email: order.email || '',
      customer_phone: order.phone || ''
    }
  });
  await storeMerchEvent(env, merchEvent);
  await recordCommerceEvent(env, commercePayloadFromMerchEvent(merchEvent, 'noahgrove')).catch(error => console.log('commerce stats record failed', error?.message || String(error)));
}
