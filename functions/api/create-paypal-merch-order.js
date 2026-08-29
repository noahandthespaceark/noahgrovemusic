import { json, parseAndValidateOrder, itemLabel, money, sendMerchEmailPossible } from './_merch-shared.js';

export async function onRequestPost({ request, env }) {
  try {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return json({ ok: false, error: 'Missing PayPal credentials.' }, 500);
    const order = parseAndValidateOrder(await request.json());
    const base = env.PAYPAL_ENVIRONMENT === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    const token = await paypalAccessToken(base, env);
    const amount = order.total.toFixed(2);
    const payload = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: order.referenceId,
        custom_id: order.referenceId,
        description: 'NoahGrove.com merch order',
        amount: {
          currency_code: 'USD',
          value: amount,
          breakdown: {
            item_total: { currency_code: 'USD', value: order.subtotal.toFixed(2) },
            shipping: { currency_code: 'USD', value: order.shipping.toFixed(2) }
          }
        },
        items: order.cartItems.map(item => ({
          name: itemLabel(item).slice(0, 127),
          quantity: String(item.quantity),
          unit_amount: { currency_code: 'USD', value: Number(item.price).toFixed(2) },
          category: 'PHYSICAL_GOODS'
        }))
      }],
      application_context: { shipping_preference: order.deliveryMethod === 'ship' ? 'GET_FROM_FILE' : 'NO_SHIPPING' }
    };
    const res = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': order.referenceId },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return json({ ok: false, error: 'PayPal order could not be created.', details: data }, 502);
    await sendMerchEmailPossible({ ...order, paymentMethod: 'PayPal / Venmo' }, env, { method: 'PayPal / Venmo', paid: false });
    return json({ ok: true, id: data.id, referenceId: order.referenceId });
  } catch (error) { return json({ ok: false, error: error?.message || 'Unexpected PayPal server error.' }, 400); }
}
async function paypalAccessToken(base, env) {
  const credentials = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error('Could not authenticate with PayPal.');
  return data.access_token;
}
