import { json, parseAndValidateOrder, sendMerchReceiptEmails } from './_merch-shared.js';
import { buildMerchEvent, storeMerchEvent } from './_merch-firebot-shared.js';
import { commercePayloadFromMerchEvent, recordCommerceEvent } from './_commerce-stats.js';

export async function onRequestPost({ request, env }) {
  try {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return json({ ok: false, error: 'Missing PayPal credentials.' }, 500);
    const body = await request.json();
    const paypalOrderId = String(body.paypalOrderId || '').trim();
    if (!paypalOrderId) return json({ ok: false, error: 'Missing PayPal order ID.' }, 400);
    const order = parseAndValidateOrder(body);
    const base = env.PAYPAL_ENVIRONMENT === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    const token = await paypalAccessToken(base, env);
    const res = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `${order.referenceId}-capture` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return json({ ok: false, error: 'PayPal payment could not be captured.', details: data }, 502);
    const status = data?.status || '';
    if (status !== 'COMPLETED') return json({ ok: false, error: `PayPal payment status is ${status || 'unknown'}.`, details: data }, 502);
    await queuePayPalFirebotEvent(data, order, env);
    await sendMerchReceiptEmails({ ...order, paymentMethod: 'PayPal / Venmo' }, env, { method: 'PayPal / Venmo' });
    return json({ ok: true, status, referenceId: order.referenceId });
  } catch (error) { return json({ ok: false, error: error?.message || 'Unexpected PayPal capture error.' }, 400); }
}
async function paypalAccessToken(base, env) {
  const credentials = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error('Could not authenticate with PayPal.');
  return data.access_token;
}


async function queuePayPalFirebotEvent(paypalCaptureData, order, env) {
  if (!env.TIP_EVENTS) return;
  const purchaseUnit = paypalCaptureData?.purchase_units?.[0] || {};
  const capture = purchaseUnit?.payments?.captures?.[0] || {};
  const amountValue = Number(capture?.amount?.value || order?.total || 0);
  const amountCents = Math.round(amountValue * 100);
  const merchEvent = buildMerchEvent({
    id: capture?.id || paypalCaptureData?.id || order.referenceId || crypto.randomUUID(),
    provider: 'paypal_or_venmo',
    amountCents,
    currency: capture?.amount?.currency_code || 'USD',
    paymentId: capture?.id || paypalCaptureData?.id || '',
    orderId: paypalCaptureData?.id || '',
    referenceId: order.referenceId || purchaseUnit.reference_id || '',
    receiptUrl: '',
    metadata: {
      source: 'noahgrove.com merch paypal venmo',
      payment_method: 'PayPal / Venmo',
      delivery_method: order.deliveryMethod || '',
      customer_name: order.fullName || '',
      customer_email: order.email || ''
    }
  });
  await storeMerchEvent(env, merchEvent);
  await recordCommerceEvent(env, commercePayloadFromMerchEvent(merchEvent, 'noahgrove')).catch(error => console.log('commerce stats record failed', error?.message || String(error)));
}
