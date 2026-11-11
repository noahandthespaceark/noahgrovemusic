// Private, durable receipts. This ledger never dispatches Firebot or charges a buyer.
const clean = (value, max = 500) => String(value || '').trim().slice(0, max);
export async function ensureTipHistory(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tip_receipts (id TEXT PRIMARY KEY, paid_at TEXT NOT NULL, provider TEXT NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS tip_receipts_paid_at ON tip_receipts(paid_at,id)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tip_checkout_context (reference_id TEXT PRIMARY KEY, provider_order_id TEXT, data_json TEXT NOT NULL, created_at TEXT NOT NULL)`).run();
}
export async function checkoutContext(env, body) {
  const context = { guestName: clean(body.guest_name, 120), message: clean(body.message, 1000) };
  const id = clean(body.request_id, 160), token = clean(body.guest_token, 200);
  if (id && token) {
    const row = await env.DB.prepare(`SELECT r.id,r.session_id,r.requester_name,r.custom_title,r.custom_artist,s.title AS song_title,s.artist AS song_artist FROM song_requests r LEFT JOIN songs s ON s.id=r.song_id WHERE r.id=? AND r.guest_token=?`).bind(id, token).first();
    if (row) Object.assign(context, { requestId: row.id, sessionId: row.session_id, requestGuestName: clean(row.requester_name,120), songTitle: clean(row.song_title || row.custom_title), songArtist: clean(row.song_artist || row.custom_artist) });
  }
  return context;
}
export async function saveCheckoutContext(env, referenceId, orderId, context) {
  await ensureTipHistory(env);
  await env.DB.prepare('INSERT INTO tip_checkout_context (reference_id,provider_order_id,data_json,created_at) VALUES (?,?,?,?)').bind(referenceId, orderId || '', JSON.stringify(context), new Date().toISOString()).run();
}
export async function readCheckoutContext(env, referenceId, orderId) {
  const row = await env.DB.prepare('SELECT data_json FROM tip_checkout_context WHERE reference_id=? OR (provider_order_id<>\'\' AND provider_order_id=?) LIMIT 1').bind(referenceId || '', orderId || '').first();
  return row ? JSON.parse(row.data_json) : {};
}
export async function saveTipReceipt(env, receipt) {
  await ensureTipHistory(env);
  const fields = Object.fromEntries(Object.entries(receipt).filter(([,v]) => v !== undefined && v !== null && v !== ''));
  await env.DB.prepare(`INSERT INTO tip_receipts (id,paid_at,provider,data_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=json_patch(tip_receipts.data_json,excluded.data_json),updated_at=excluded.updated_at`).bind(receipt.id, new Date(receipt.paidAt).toISOString(), receipt.provider, JSON.stringify(fields), new Date().toISOString()).run();
}
export function isSquareTip(payment, order) {
  const meta = order?.metadata || {};
  const source = clean(meta.source).toLowerCase();
  const items = (order?.line_items || []).map(x => clean(x.name).toLowerCase());
  // Exact integrations/line items only. A generic note containing "tip" is not evidence.
  return !source.includes('merch') && (/^(SB|NG)-TIP-/.test(String(order?.reference_id || '')) || items.some(x => ['tip the music','support the music'].includes(x)) || /^setbliss request page tip\b/.test(source));
}
export async function squareGet(env, path) {
  const base = env.SQUARE_ENVIRONMENT === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`, 'Square-Version':'2026-05-20' }, signal: AbortSignal.timeout(8000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Square read failed (${res.status}${data.errors?.[0]?.code ? ', '+data.errors[0].code : ''}).`);
  return data;
}
export async function squareTipReceipt(env, payment, order, warnings = []) {
  const context = await readCheckoutContext(env, order?.reference_id, payment.order_id);
  let customer = {};
  if (payment.customer_id) {
    try { customer = (await squareGet(env, '/v2/customers/' + encodeURIComponent(payment.customer_id))).customer || {}; }
    catch { warnings.push('Some Square customer details could not be read.'); }
  }
  return {
    id: 'square:' + payment.id, provider:'square', paymentId:payment.id, orderId:payment.order_id || '', referenceId:order?.reference_id || '',
    paidAt: payment.created_at, providerUpdatedAt:payment.updated_at, status:payment.status,
    amountCents: Number(payment.total_money?.amount ?? payment.amount_money?.amount ?? 0), refundedCents:Number(payment.refunded_money?.amount || 0), currency: payment.amount_money?.currency || 'USD',
    receiptUrl: /^https:\/\/(squareup\.com|square\.link)\//.test(payment.receipt_url || '') ? payment.receipt_url : '',
    customerName:clean([customer.given_name,customer.family_name].filter(Boolean).join(' '),160), customerEmail:clean(payment.buyer_email_address || customer.email_address,254),
    customerId:clean(payment.customer_id,160), paymentNote:clean(payment.note,1000), ...context,
    identityNote:'Guest names are self-reported; Square customer details identify the payer, who may be a different person.',
    feedbackNote:'Square receipt feedback is separate and is not available from the Payments API.'
  };
}
export function tipWindow(params, now = Date.now()) {
  const before = params.get('before') || new Date(now).toISOString();
  const after = params.get('after') || new Date(Date.parse(before)-30*86400000).toISOString();
  const valid = v => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
  if (!valid(after) || !valid(before) || Date.parse(before)<=Date.parse(after) || Date.parse(before)-Date.parse(after)>93*86400000) throw new Error('Choose valid timestamps spanning no more than 93 days.');
  return {after:new Date(after).toISOString(),before:new Date(before).toISOString()};
}
export async function tipHistory(env, params) {
  const window = tipWindow(params);
  await ensureTipHistory(env);
  const warnings = [], provider = { state: env.SQUARE_ACCESS_TOKEN ? 'available' : 'not_configured', next_cursor:null, scanned:0, matched:0 };
  if (env.SQUARE_ACCESS_TOKEN) {
    try {
      if (!env.SQUARE_LOCATION_ID) throw new Error('Square location is not configured.');
      const q = new URLSearchParams({ begin_time:window.after,end_time:window.before,sort_order:'DESC',limit:'10',location_id:env.SQUARE_LOCATION_ID });
      const cursor = params.get('square_cursor'); if (cursor) q.set('cursor',clean(cursor,2048));
      const data = await squareGet(env, '/v2/payments?' + q);
      provider.next_cursor = data.cursor || null;
      for (const payment of data.payments || []) {
        provider.scanned++;
        if (payment.location_id !== env.SQUARE_LOCATION_ID || !['COMPLETED','APPROVED'].includes(payment.status)) continue;
        // Keep the requested half-open interval, independent of the provider's boundary behavior.
        if (Date.parse(payment.created_at) < Date.parse(window.after) || Date.parse(payment.created_at) >= Date.parse(window.before)) continue;
        let order = null;
        try { if (payment.order_id) order = (await squareGet(env, '/v2/orders/'+encodeURIComponent(payment.order_id))).order; }
        catch { warnings.push('Some orders could not be inspected, so tip coverage is incomplete.'); continue; }
        if (!isSquareTip(payment,order)) continue;
        if (payment.status !== 'COMPLETED') continue;
        await saveTipReceipt(env, await squareTipReceipt(env,payment,order,warnings));
        provider.matched++;
      }
    } catch (error) { provider.state='unavailable'; warnings.push(error.message); }
  } else warnings.push('Square is not configured. Showing saved receipts only.');
  const limit=Math.min(100,Math.max(1,Math.floor(Number(params.get('limit')) || 50)));
  const offset=Math.min(10000,Math.max(0,Math.floor(Number(params.get('offset')) || 0)));
  const rows=(await env.DB.prepare('SELECT data_json FROM tip_receipts WHERE paid_at>=? AND paid_at<? ORDER BY paid_at DESC,id LIMIT ? OFFSET ?').bind(window.after,window.before,limit+1,offset).all()).results || [];
  const receipts=rows.slice(0,limit).map(r=>JSON.parse(r.data_json));
  const totals=(await env.DB.prepare('SELECT json_extract(data_json,\'$.currency\') AS currency,COUNT(*) AS count,SUM(json_extract(data_json,\'$.amountCents\')) AS amountCents,SUM(COALESCE(json_extract(data_json,\'$.refundedCents\'),0)) AS refundedCents FROM tip_receipts WHERE paid_at>=? AND paid_at<? GROUP BY currency').bind(window.after,window.before).all()).results || [];
  return {ok:true,receipts,totals,window,has_more:rows.length>limit,next_offset:rows.length>limit?offset+limit:null,square:provider,partial:provider.state!=='available'||!!provider.next_cursor||warnings.length>0,warnings:[...new Set(warnings)],retrieved_at:new Date().toISOString(),source:'setbliss',feedback_available:false};
}
