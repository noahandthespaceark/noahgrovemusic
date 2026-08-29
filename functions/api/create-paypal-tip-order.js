import { json } from './_tip-shared.js';

export async function onRequestPost({ request, env }) {
  try {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return json({ ok: false, error: 'Missing PayPal credentials.' }, 500);
    const body = await request.json().catch(() => ({}));
    const amount = normalizeAmount(body.amount);
    if (!amount) return json({ ok: false, error: 'Please enter a tip amount between $1 and $500.' }, 400);

    const base = env.PAYPAL_ENVIRONMENT === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    const token = await paypalAccessToken(base, env);
    const referenceId = `NG-TIP-PP-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const origin = new URL(request.url).origin;
    const payload = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: referenceId,
        custom_id: referenceId,
        description: `NoahGrove.com tip - ${money(amount)}`,
        amount: { currency_code: 'USD', value: amount.toFixed(2) }
      }],
      application_context: {
        brand_name: 'Noah Grove Music',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        return_url: `${origin}/support?tip=thanks`,
        cancel_url: `${origin}/support?tip=cancelled`
      }
    };

    const res = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': referenceId
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return json({ ok: false, error: 'PayPal/Venmo tip order could not be created.', details: data }, 502);
    return json({ ok: true, id: data.id, referenceId });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Unexpected PayPal/Venmo tip server error.' }, 500);
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
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
