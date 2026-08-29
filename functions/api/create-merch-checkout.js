import { json, parseAndValidateOrder, dollarsToCents, buildBuyerNote, buildSquareReceiptItemName, savePendingMerchOrder } from './_merch-shared.js';

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const orderData = parseAndValidateOrder(body);

    if (!env.SQUARE_ACCESS_TOKEN) return json({ ok: false, error: 'Missing SQUARE_ACCESS_TOKEN.' }, 500);
    if (!env.SQUARE_LOCATION_ID) return json({ ok: false, error: 'Missing SQUARE_LOCATION_ID.' }, 500);

    const origin = new URL(request.url).origin;
    const squareBase = env.SQUARE_ENVIRONMENT === 'sandbox'
      ? 'https://connect.squareupsandbox.com'
      : 'https://connect.squareup.com';

    const itemName = buildSquareReceiptItemName(orderData);
    const squarePayload = {
      idempotency_key: crypto.randomUUID(),
      quick_pay: {
        // This is the line Square shows on its receipt, so use the purchased item(s)
        // instead of a generic “merch order” label.
        name: `${itemName} (${orderData.referenceId})`,
        price_money: { amount: dollarsToCents(orderData.total), currency: 'USD' },
        location_id: env.SQUARE_LOCATION_ID
      },
      payment_note: buildBuyerNote(orderData).slice(0, 500),
      checkout_options: {
        redirect_url: `${origin}/support?merch=thanks&ref=${encodeURIComponent(orderData.referenceId)}`,
        ask_for_shipping_address: false
      }
    };

    const squareRes = await fetch(`${squareBase}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2026-05-20'
      },
      body: JSON.stringify(squarePayload)
    });

    const squareText = await squareRes.text();
    let squareData = null;
    try { squareData = squareText ? JSON.parse(squareText) : null; } catch (_) { squareData = { raw: squareText }; }

    if (!squareRes.ok) {
      const firstError = squareData?.errors?.[0];
      return json({
        ok: false,
        error: firstError?.detail || firstError?.code || 'Square checkout could not be created.',
        details: squareData,
        sent: squarePayload
      }, 400);
    }

    const checkoutUrl = squareData?.payment_link?.url;
    if (!checkoutUrl) return json({ ok: false, error: 'Square did not return a checkout URL.', details: squareData }, 400);

    await savePendingMerchOrder(env, { ...orderData, checkoutUrl, paymentLinkId: squareData?.payment_link?.id || '' });
    return json({ ok: true, checkoutUrl, referenceId: orderData.referenceId });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Unexpected server error.' }, 400);
  }
}
