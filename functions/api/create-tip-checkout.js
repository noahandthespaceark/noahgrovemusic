export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    const amount = normalizeAmount(body.amount);
    if (!amount) return json({ ok: false, error: 'Please enter a tip amount between $1 and $500.' }, 400);

    if (!env.SQUARE_ACCESS_TOKEN) return json({ ok: false, error: 'Missing SQUARE_ACCESS_TOKEN.' }, 500);
    if (!env.SQUARE_LOCATION_ID) return json({ ok: false, error: 'Missing SQUARE_LOCATION_ID.' }, 500);

    const origin = new URL(request.url).origin;
    const referenceId = `NG-TIP-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const squareBase = env.SQUARE_ENVIRONMENT === 'sandbox'
      ? 'https://connect.squareupsandbox.com'
      : 'https://connect.squareup.com';

    const squarePayload = {
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: env.SQUARE_LOCATION_ID,
        reference_id: referenceId,
        line_items: [{
          name: 'Tip the Music',
          quantity: '1',
          base_price_money: { amount: dollarsToCents(amount), currency: 'USD' }
        }],
        metadata: {
          source: 'noahgrove.com support tip',
          trigger_firebot: 'true',
          tip_amount: String(amount),
          page: '/support'
        }
      },
      checkout_options: {
        redirect_url: `${origin}/support?tip=thanks`,
        ask_for_shipping_address: false,
        merchant_support_email: env.MERCH_SUPPORT_EMAIL || env.QUOTE_TO_EMAIL || 'noah@noahgrove.com'
      },
      description: `NoahGrove.com tip - ${money(amount)} - ${referenceId}`
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

    if (!squareRes.ok) return json({ ok: false, error: 'Tip checkout could not be created.', details: squareData }, 502);
    const checkoutUrl = squareData?.payment_link?.url;
    if (!checkoutUrl) return json({ ok: false, error: 'Square did not return a checkout URL.', details: squareData }, 502);

    return json({ ok: true, checkoutUrl, referenceId });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Unexpected server error.' }, 500);
  }
}

function normalizeAmount(value) {
  const amount = Number(String(value || '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(amount) || amount < 1 || amount > 500) return 0;
  return Math.round(amount * 100) / 100;
}
function dollarsToCents(value) { return Math.round(Number(value || 0) * 100); }
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
