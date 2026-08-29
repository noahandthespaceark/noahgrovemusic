import { buildTipEvent, storeTipEvent as queueTipEvent, timingSafeEqual } from './_tip-shared.js';
import { buildMerchEvent, storeMerchEvent } from './_merch-firebot-shared.js';
import { findMerchReference, loadPendingMerchOrder, sendMerchReceiptEmails } from './_merch-shared.js';
import { commercePayloadFromMerchEvent, commercePayloadFromTipEvent, recordCommerceEvent } from './_commerce-stats.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const rawBody = await request.text();

  if (env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
    const signature = request.headers.get('x-square-hmacsha256-signature') || '';
    const notificationUrls = buildSquareNotificationUrlCandidates(request, env);
    const valid = await verifySquareSignatureForAnyUrl(rawBody, signature, env.SQUARE_WEBHOOK_SIGNATURE_KEY, notificationUrls);
    if (!valid) {
      console.log('Square webhook signature verification failed', {
        requestUrl: request.url,
        configuredUrl: env.SQUARE_WEBHOOK_URL || '',
        triedUrls: notificationUrls
      });
      return new Response('Invalid signature', { status: 401 });
    }
  }

  let event;
  try { event = JSON.parse(rawBody); } catch (_) { return new Response('Bad JSON', { status: 400 }); }

  const payment = event?.data?.object?.payment;
  const type = event?.type || 'square.webhook';
  const isCompletedPayment = type.includes('payment') && payment?.status === 'COMPLETED';

  if (isCompletedPayment) {
    const orderId = payment.order_id || '';
    const order = orderId ? await fetchSquareOrder(orderId, env) : null;
    const source = detectSquareSource(payment, order);
    const shouldTriggerFirebot = source.includes('support tip') || source.includes('merch') || payment?.metadata?.trigger_firebot === 'true' || order?.metadata?.trigger_firebot === 'true';
    if (shouldTriggerFirebot) await storeFirebotEvent({ event, payment, order, source }, env);
    if (source.includes('support tip')) {
      await sendPaidTipEmail({ event, payment, order }, env);
    } else {
      await sendPaidMerchEmail({ event, payment, order }, env);
    }
  }

  return new Response('OK', { status: 200 });
}


function detectSquareSource(payment, order) {
  const explicit = String(order?.metadata?.source || payment?.metadata?.source || '').toLowerCase();
  if (explicit) return explicit;
  const lineText = (order?.line_items || [])
    .map(item => `${item.name || ''} ${item.note || ''} ${item.variation_name || ''}`)
    .join(' ')
    .toLowerCase();
  if (lineText.includes('noahgrove.com merch order') || lineText.includes('merch order')) return 'noahgrove.com merch square checkout';
  if (lineText.includes('support tip') || lineText.includes('tip')) return 'noahgrove.com support tip square checkout';
  return '';
}

function buildSquareNotificationUrlCandidates(request, env) {
  const urls = new Set();
  if (env.SQUARE_WEBHOOK_URL) urls.add(String(env.SQUARE_WEBHOOK_URL).trim());
  urls.add(request.url);

  for (const url of [...urls]) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'www.noahgrove.com') {
        parsed.hostname = 'noahgrove.com';
        urls.add(parsed.toString());
      } else if (parsed.hostname === 'noahgrove.com') {
        parsed.hostname = 'www.noahgrove.com';
        urls.add(parsed.toString());
      }
    } catch (_) {}
  }

  return [...urls].filter(Boolean);
}

async function verifySquareSignatureForAnyUrl(rawBody, signature, signatureKey, notificationUrls) {
  if (!signature) return false;
  for (const notificationUrl of notificationUrls) {
    if (await verifySquareSignature(rawBody, signature, signatureKey, notificationUrl)) return true;
  }
  return false;
}

async function verifySquareSignature(rawBody, signature, signatureKey, notificationUrl) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(signatureKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(notificationUrl + rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return timingSafeEqual(expected, signature);
}
async function fetchSquareOrder(orderId, env) {
  if (!env.SQUARE_ACCESS_TOKEN) return null;
  const squareBase = env.SQUARE_ENVIRONMENT === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  try {
    const res = await fetch(`${squareBase}/v2/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`, 'Square-Version': '2026-05-20' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.order || null;
  } catch (_) {
    return null;
  }
}

async function storeFirebotEvent({ event, payment, order, source }, env) {
  const amountCents = payment?.amount_money?.amount || order?.total_money?.amount || 0;
  const metadata = { ...(payment?.metadata || {}), ...(order?.metadata || {}), source: source || order?.metadata?.source || payment?.metadata?.source || '' };
  const isMerch = source.includes('merch') || metadata.firebot_event_type === 'merch_purchase';
  const firebotEvent = isMerch ? buildMerchEvent({
    id: payment?.id || event?.event_id || crypto.randomUUID(),
    provider: 'square',
    amountCents,
    currency: payment?.amount_money?.currency || order?.total_money?.currency || 'USD',
    paymentId: payment?.id || '',
    orderId: payment?.order_id || order?.id || '',
    referenceId: order?.reference_id || '',
    receiptUrl: payment?.receipt_url || '',
    metadata
  }) : buildTipEvent({
    id: payment?.id || event?.event_id || crypto.randomUUID(),
    provider: 'square',
    amountCents,
    currency: payment?.amount_money?.currency || order?.total_money?.currency || 'USD',
    paymentId: payment?.id || '',
    orderId: payment?.order_id || order?.id || '',
    referenceId: order?.reference_id || '',
    receiptUrl: payment?.receipt_url || '',
    metadata
  });
  const queued = isMerch ? await storeMerchEvent(env, firebotEvent) : await queueTipEvent(env, firebotEvent);
  await recordCommerceEvent(env, isMerch ? commercePayloadFromMerchEvent(firebotEvent, 'noahgrove') : commercePayloadFromTipEvent(firebotEvent, 'noahgrove')).catch(error => console.log('commerce stats record failed', error?.message || String(error)));
  return queued;
}
async function sendPaidTipEmail({ event, payment, order }, env) {
  if (!env.RESEND_API_KEY || !env.QUOTE_TO_EMAIL || !env.QUOTE_FROM_EMAIL) return;
  const amount = payment?.amount_money?.amount ? `$${(payment.amount_money.amount / 100).toFixed(2)}` : 'See Square';
  const reference = order?.reference_id || payment?.order_id || event?.event_id || 'Square tip';
  const text = [
    'PAID TIP RECEIVED', '',
    `Reference: ${reference}`,
    `Amount paid: ${amount}`,
    `Order ID: ${payment?.order_id || ''}`,
    `Payment ID: ${payment?.id || ''}`,
    '',
    env.TIP_EVENTS ? 'Queued for Firebot listener.' : 'TIP_EVENTS KV is not configured, so this was not queued for Firebot.'
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;color:#111;line-height:1.5;max-width:720px;margin:0 auto;"><h2>Paid Tip Received</h2><p><strong>Reference:</strong> ${esc(reference)}</p><p><strong>Amount paid:</strong> ${esc(amount)}</p><p><strong>Payment ID:</strong> ${esc(payment?.id || '')}</p><p>${env.TIP_EVENTS ? 'Queued for Firebot listener.' : 'TIP_EVENTS KV is not configured, so this was not queued for Firebot.'}</p></div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.QUOTE_FROM_EMAIL, to: [env.QUOTE_TO_EMAIL], subject: `Paid tip received – ${amount}`, html, text })
  });
}

async function sendPaidMerchEmail({ event, payment, order }, env) {
  const reference = findMerchReference({ event, payment, order }) || order?.reference_id || payment?.order_id || event?.event_id || '';
  const pendingOrder = await loadPendingMerchOrder(env, reference);
  if (pendingOrder?.cartItems?.length) {
    await sendMerchReceiptEmails({ ...pendingOrder, paymentMethod: 'Square Checkout' }, env, { method: 'Square Checkout' });
    return;
  }

  // Fallback: Square told us a merch payment happened, but the original website
  // order details were not found in KV. Noah still gets a paid-order notice.
  if (!env.RESEND_API_KEY || !env.QUOTE_TO_EMAIL || !env.QUOTE_FROM_EMAIL) return;
  const lineItems = (order?.line_items || []).map(item => `${item.name || 'Item'} x ${item.quantity || '1'}`).join('\n') || 'See Square order';
  const amount = payment?.amount_money?.amount ? `$${(payment.amount_money.amount / 100).toFixed(2)}` : 'See Square';
  const metadata = order?.metadata || {};
  const text = [
    'PAID MERCH ORDER', '',
    `Reference: ${reference || 'Square payment'}`,
    `Amount paid: ${amount}`,
    `Order ID: ${payment?.order_id || ''}`,
    `Payment ID: ${payment?.id || ''}`,
    '', 'Items:', lineItems,
    '', 'Customer/details from order metadata:',
    JSON.stringify(metadata, null, 2),
    '', 'The original website order was not found, so no customer receipt could be sent automatically. Check Square Dashboard for buyer details.'
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;color:#111;line-height:1.5;max-width:720px;margin:0 auto;"><h2>Paid Merch Order</h2><p><strong>Reference:</strong> ${esc(reference || 'Square payment')}</p><p><strong>Amount paid:</strong> ${esc(amount)}</p><p><strong>Order ID:</strong> ${esc(payment?.order_id || '')}</p><h3>Items</h3><pre style="white-space:pre-wrap;background:#f7f7f7;border:1px solid #eee;border-radius:10px;padding:12px;">${esc(lineItems)}</pre><p>The original website order was not found, so no customer receipt could be sent automatically. Check Square Dashboard for buyer details.</p></div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.QUOTE_FROM_EMAIL, to: [env.QUOTE_TO_EMAIL], subject: `Paid merch order – ${reference || 'Square payment'}`, html, text })
  });
}
function esc(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
