import { buildTipEvent, json, storeTipEvent } from './_tip-shared.js';
import { commercePayloadFromTipEvent, recordCommerceEvent } from './_commerce-stats.js';

export async function onRequestPost({ request, env }) {
  try {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return json({ ok: false, error: 'Missing PayPal credentials.' }, 500);
    const body = await request.json().catch(() => ({}));
    const paypalOrderId = String(body.paypalOrderId || '').trim();
    const expectedAmount = normalizeAmount(body.amount);
    if (!paypalOrderId) return json({ ok: false, error: 'Missing PayPal order ID.' }, 400);
    if (!expectedAmount) return json({ ok: false, error: 'Please enter a tip amount between $1 and $500.' }, 400);

    const base = env.PAYPAL_ENVIRONMENT === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    const token = await paypalAccessToken(base, env);
    const res = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `${paypalOrderId}-capture`
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return json({ ok: false, error: 'PayPal/Venmo tip payment could not be captured.', details: data }, 502);
    if (data?.status !== 'COMPLETED') return json({ ok: false, error: `PayPal/Venmo tip status is ${data?.status || 'unknown'}.`, details: data }, 502);

    const purchaseUnit = data?.purchase_units?.[0] || {};
    const capture = purchaseUnit?.payments?.captures?.[0] || {};
    const amountValue = Number(capture?.amount?.value || expectedAmount || 0);
    const amountCents = Math.round(amountValue * 100);
    const referenceId = purchaseUnit.reference_id || purchaseUnit.custom_id || '';
    const tipEvent = buildTipEvent({
      id: capture?.id || data?.id || crypto.randomUUID(),
      provider: 'paypal_venmo',
      amountCents,
      currency: capture?.amount?.currency_code || 'USD',
      paymentId: capture?.id || '',
      orderId: data?.id || paypalOrderId,
      referenceId,
      receiptUrl: '',
      metadata: {
        source: 'noahgrove.com support tip paypal venmo',
        payment_method: 'PayPal / Venmo',
        page: '/support',
        trigger_firebot: 'true'
      }
    });
    await storeTipEvent(env, tipEvent);
    await recordCommerceEvent(env, commercePayloadFromTipEvent(tipEvent, 'noahgrove'), request).catch(error => console.log('commerce stats record failed', error?.message || String(error)));
    return json({ ok: true, status: data.status, referenceId, amount: amountValue });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Unexpected PayPal/Venmo capture error.' }, 500);
  }
}

async function paypalAccessToken(base, env) {
  const credentials = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error('Could not authenticate with PayPal.');
  return data.access_token;
}

function normalizeAmount(value) {
  const amount = Number(String(value || '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(amount) || amount < 1 || amount > 500) return 0;
  return Math.round(amount * 100) / 100;
}
