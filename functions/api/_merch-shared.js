export const MERCH_CATALOG = {
  'album-big-picture': { name: 'Big Picture Album', price: 10 },
  'album-beautiful-frankenstein': { name: 'Beautiful Frankenstein Album', price: 10 },
  'album-li-shuang': { name: 'Noah Grove by Li Shuang Album', price: 10 },
  'sticker-big-picture': { name: 'Big Picture Sticker', price: 1 },
  'sticker-beautiful-frankenstein': { name: 'Beautiful Frankenstein Sticker', price: 1 },
  'sticker-spaceark-logo': { name: 'Space ARK Logo Sticker', price: 1 },
  shirt: { name: 'SpaceArk Shirt', price: 20, sizes: ['S', 'M', 'L', 'XL'] },
  hat: { name: 'SpaceArk Hat', price: 10 },
  mug: { name: 'SpaceArk Mug', price: 15 }
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
export function dollarsToCents(value) { return Math.round(Number(value || 0) * 100); }
export function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
export function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()); }
export function esc(value) {
  return String(value || '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
export function normalizeCart(incomingItems, catalog = MERCH_CATALOG) {
  const merged = new Map();
  for (const raw of incomingItems || []) {
    const id = String(raw?.id || '').trim();
    const catalogItem = catalog[id];
    if (!catalogItem) continue;
    const quantity = Math.max(0, Math.min(99, Number.parseInt(raw?.quantity, 10) || 0));
    if (!quantity) continue;
    const size = id === 'shirt' ? String(raw?.size || '').trim().toUpperCase() : '';
    if (id === 'shirt' && !catalogItem.sizes.includes(size)) continue;
    const key = size ? `${id}::${size}` : id;
    const current = merged.get(key) || { id, name: catalogItem.name, price: catalogItem.price, quantity: 0, ...(size ? { size } : {}) };
    current.quantity = Math.min(99, current.quantity + quantity);
    merged.set(key, current);
  }
  return Array.from(merged.values());
}
export function parseAndValidateOrder(body) {
  const required = ['fullName', 'email', 'phone'];
  for (const field of required) {
    if (!String(body[field] || '').trim()) throw new Error(`Missing required field: ${field}`);
  }
  if (!isValidEmail(body.email)) throw new Error('Invalid email address.');
  let incomingItems = [];
  try { incomingItems = Array.isArray(body.cartItems) ? body.cartItems : JSON.parse(String(body.cartItems || '[]')); }
  catch (_) { throw new Error('Invalid cart data.'); }
  const cartItems = normalizeCart(incomingItems);
  if (!cartItems.length) throw new Error('Your order is empty.');
  const deliveryMethod = body.deliveryMethod === 'ship' ? 'ship' : 'pickup';
  if (deliveryMethod === 'ship') {
    for (const field of ['address1', 'city', 'state', 'zip']) {
      if (!String(body[field] || '').trim()) throw new Error(`Missing shipping field: ${field}`);
    }
  }
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shipping = deliveryMethod === 'ship' ? 5 : 0;
  const total = subtotal + shipping;
  const referenceId = body.referenceId || `NG-MERCH-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  return { ...body, cartItems, subtotal, shipping, total, referenceId, deliveryMethod };
}
export function itemLabel(item) { return item.size ? `${item.name} - Size ${item.size}` : item.name; }
export function summarizeItems(items) { return items.map(item => `${itemLabel(item)} x${item.quantity}`).join('; '); }
export function buildBuyerNote(data) {
  const address = data.deliveryMethod === 'ship'
    ? `${data.address1 || ''}${data.address2 ? `, ${data.address2}` : ''}, ${data.city || ''}, ${data.state || ''} ${data.zip || ''}`
    : 'Pickup from Noah at a gig';
  return [
    `NoahGrove.com merch order`,
    `Reference: ${data.referenceId}`,
    '',
    'Items:',
    ...data.cartItems.map(item => `- ${itemLabel(item)}: ${item.quantity} x ${money(item.price)} = ${money(item.price * item.quantity)}`),
    '',
    `Subtotal: ${money(data.subtotal)}`,
    `Delivery: ${data.deliveryMethod === 'ship' ? `Ship (+${money(data.shipping)})` : 'Pickup at a gig'}`,
    `Total: ${money(data.total)}`,
    '',
    `Customer: ${data.fullName}`,
    `Email: ${data.email}`,
    `Phone: ${data.phone}`,
    `Address/Pickup: ${address}`,
    data.notes ? `Notes: ${data.notes}` : ''
  ].filter(Boolean).join('\n');
}
function row(label, value) {
  return `<tr><td style="padding:10px 12px;border-bottom:1px solid #e9e9e9;font-weight:700;width:180px;vertical-align:top;">${esc(label)}</td><td style="padding:10px 12px;border-bottom:1px solid #e9e9e9;white-space:pre-wrap;">${esc(value)}</td></tr>`;
}


export function buildSquareReceiptItemName(order) {
  const summary = summarizeItems(order.cartItems || []);
  const base = summary || `NoahGrove.com merch order ${order.referenceId || ''}`;
  return base.length > 190 ? `${base.slice(0, 187)}...` : base;
}

export async function savePendingMerchOrder(env, order) {
  if (!env.TIP_EVENTS || !order?.referenceId) return { ok: false, skipped: true };
  const record = { ...order, savedAt: new Date().toISOString() };
  await env.TIP_EVENTS.put(`merch:order:${order.referenceId}`, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 30 });
  return { ok: true };
}

export async function loadPendingMerchOrder(env, referenceId) {
  if (!env.TIP_EVENTS || !referenceId) return null;
  try {
    const raw = await env.TIP_EVENTS.get(`merch:order:${referenceId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

export function findMerchReference({ payment, order, event } = {}) {
  const candidates = [
    order?.reference_id,
    payment?.reference_id,
    payment?.note,
    order?.metadata?.reference_id,
    payment?.metadata?.reference_id,
    event?.event_id,
    ...(order?.line_items || []).flatMap(item => [item?.name, item?.note, item?.variation_name])
  ].filter(Boolean).map(String);
  for (const text of candidates) {
    const match = text.match(/NG-MERCH-[0-9]+-[a-zA-Z0-9-]+/);
    if (match) return match[0];
  }
  return '';
}

export async function sendMerchReceiptEmails(data, env, options = {}) {
  if (!env.RESEND_API_KEY || !env.QUOTE_FROM_EMAIL) return { ok: false, skipped: true };
  const noahEmail = env.QUOTE_TO_EMAIL || 'noah@noahgrove.com';
  const customerEmail = String(data.email || '').trim();
  const paidLabel = options.method || data.paymentMethod || 'Online payment';
  const subject = `Receipt for your Noah Grove Music merch order`;
  const noahSubject = `Paid merch order - ${data.referenceId || 'NoahGrove.com'}`;
  const rows = data.cartItems.map(item => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #eadfce;">${esc(itemLabel(item))}</td>
      <td style="padding:12px;border-bottom:1px solid #eadfce;text-align:center;">${esc(item.quantity)}</td>
      <td style="padding:12px;border-bottom:1px solid #eadfce;text-align:right;">${esc(money(item.price))}</td>
      <td style="padding:12px;border-bottom:1px solid #eadfce;text-align:right;font-weight:700;">${esc(money(item.price * item.quantity))}</td>
    </tr>`).join('');
  const delivery = data.deliveryMethod === 'ship' ? `Shipping to ${data.address1 || ''}${data.address2 ? `, ${data.address2}` : ''}, ${data.city || ''}, ${data.state || ''} ${data.zip || ''}` : 'Pickup from Noah at a gig';
  const noteBlock = data.notes ? `<p style="margin:8px 0 0;color:#574b3b;"><strong>Notes:</strong> ${esc(data.notes)}</p>` : '';
  const html = `
  <div style="margin:0;padding:0;background:#f6f1e8;font-family:Arial,Helvetica,sans-serif;color:#171717;">
    <div style="max-width:680px;margin:0 auto;padding:28px 16px;">
      <div style="background:#11100e;border-radius:24px;overflow:hidden;border:1px solid #e4d2b8;box-shadow:0 18px 40px rgba(0,0,0,.15);">
        <div style="padding:28px 26px;background:linear-gradient(135deg,#1b1712,#2b2117);color:#fff;">
          <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#f1c78f;">Noah Grove Music</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.15;">Merch Receipt</h1>
          <p style="margin:10px 0 0;color:#f7eadb;">Thank you for supporting the music.</p>
        </div>
        <div style="background:#fffaf3;padding:26px;">
          <p style="margin:0 0 14px;font-size:15px;color:#42382b;"><strong>Reference:</strong> ${esc(data.referenceId || '')}</p>
          <p style="margin:0 0 20px;font-size:15px;color:#42382b;"><strong>Payment:</strong> ${esc(paidLabel)}</p>
          <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eadfce;border-radius:16px;overflow:hidden;">
            <thead><tr style="background:#f4eadb;color:#3b3126;text-transform:uppercase;font-size:12px;letter-spacing:.08em;"><th style="padding:12px;text-align:left;">Item</th><th style="padding:12px;text-align:center;">Qty</th><th style="padding:12px;text-align:right;">Each</th><th style="padding:12px;text-align:right;">Total</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div style="margin-top:18px;border-top:1px solid #eadfce;padding-top:16px;">
            <p style="margin:4px 0;text-align:right;color:#42382b;">Subtotal: <strong>${esc(money(data.subtotal))}</strong></p>
            <p style="margin:4px 0;text-align:right;color:#42382b;">Delivery: <strong>${esc(data.deliveryMethod === 'ship' ? money(data.shipping) : '$0.00')}</strong></p>
            <p style="margin:10px 0 0;text-align:right;font-size:24px;color:#11100e;">Total: <strong>${esc(money(data.total))}</strong></p>
          </div>
          <div style="margin-top:22px;padding:16px;border-radius:16px;background:#f4eadb;color:#42382b;">
            <p style="margin:0;"><strong>Delivery:</strong> ${esc(delivery)}</p>${noteBlock}
          </div>
          <p style="margin:22px 0 0;color:#6b5f51;font-size:13px;line-height:1.55;">Questions? Reply to this email or contact Noah at noah@noahgrove.com.</p>
        </div>
      </div>
    </div>
  </div>`;
  const text = buildBuyerNote(data) + `\nPayment: ${paidLabel}\nThank you for supporting Noah Grove Music.`;
  const messages = [];
  if (customerEmail && isValidEmail(customerEmail)) messages.push({ to: [customerEmail], subject, reply_to: noahEmail });
  messages.push({ to: [noahEmail], subject: noahSubject, reply_to: customerEmail || undefined });
  const results = [];
  for (const msg of messages) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.QUOTE_FROM_EMAIL, to: msg.to, reply_to: msg.reply_to, subject: msg.subject, html, text })
    });
    results.push(res.ok);
  }
  return { ok: results.every(Boolean) };
}

export async function sendMerchEmailPossible(data, env, options = {}) {
  if (!env.RESEND_API_KEY || !env.QUOTE_TO_EMAIL || !env.QUOTE_FROM_EMAIL) return { ok: false, skipped: true };
  const statusLine = options.paid ? 'A merch payment was completed. Confirm details in your payment dashboard before fulfillment.' : 'A customer started merch checkout. Confirm payment before shipping or pickup.';
  const itemRows = data.cartItems.map(item => row(itemLabel(item), `${item.quantity} x ${money(item.price)} = ${money(item.price * item.quantity)}`)).join('');
  const html = `<div style="font-family:Arial,sans-serif;color:#111;line-height:1.5;max-width:720px;margin:0 auto;"><h2>${options.paid ? 'Paid Merch Order' : 'New Merch Checkout Started'}</h2><p>${esc(statusLine)}</p><table style="width:100%;border-collapse:collapse;border:1px solid #e9e9e9;">${row('Reference', data.referenceId)}${row('Payment method', options.method || data.paymentMethod || 'Square')}${itemRows}${row('Subtotal', money(data.subtotal))}${row('Delivery', data.deliveryMethod === 'ship' ? `Ship (+${money(data.shipping)})` : 'Pickup at a gig')}${row('Total', money(data.total))}${row('Name', data.fullName)}${row('Email', data.email)}${row('Phone', data.phone)}${row('Address', data.deliveryMethod === 'ship' ? `${data.address1 || ''}${data.address2 ? `, ${data.address2}` : ''}, ${data.city || ''}, ${data.state || ''} ${data.zip || ''}` : 'Pickup at a gig')}${row('Notes', data.notes || 'None')}${data.checkoutUrl ? row('Checkout link', data.checkoutUrl) : ''}</table></div>`;
  const text = buildBuyerNote(data) + `\nPayment method: ${options.method || data.paymentMethod || 'Square'}\n${statusLine}`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.QUOTE_FROM_EMAIL,
        to: [env.QUOTE_TO_EMAIL],
        reply_to: data.email,
        subject: `${options.paid ? 'Paid merch order' : 'New merch checkout'} - ${data.cartItems.length} item type(s)`,
        html,
        text
      })
    });
    return { ok: res.ok };
  } catch (_) { return { ok: false }; }
}
