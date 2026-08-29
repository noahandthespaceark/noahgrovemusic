const DB_BINDING_NAMES = ["ANALYTICS_DB", "DB", "NOAH_ANALYTICS_DB"];

export async function recordCommerceEvent(env, input = {}, request = null) {
  const db = getDb(env);
  if (!db) return { ok: false, skipped: true, reason: 'missing_d1' };
  await ensureSchema(db);

  const kind = String(input.kind || input.type || '').toLowerCase().includes('merch') ? 'merch_paid' : 'tip_paid';
  const amount = Number(input.amount ?? centsToDollars(input.amountCents));
  const amountCents = Number.isFinite(Number(input.amountCents)) ? Math.round(Number(input.amountCents)) : Math.round((Number.isFinite(amount) ? amount : 0) * 100);
  const sourceSite = clean(input.sourceSite || input.site || input.source_site || detectSourceSite(input.source || input.metadata?.source), 80);
  const page = clean(input.page || input.metadata?.page || (sourceSite === 'setbliss' ? '/request' : '/support'), 512);
  const provider = clean(input.provider || input.paymentMethod || input.metadata?.payment_method || '', 80);
  const referenceId = clean(input.referenceId || input.reference_id || '', 512);
  const paymentId = clean(input.paymentId || input.payment_id || '', 512);
  const orderId = clean(input.orderId || input.order_id || '', 512);
  const itemTitle = kind === 'merch_paid'
    ? clean(input.itemSummary || input.orderSummary || input.metadata?.order_summary || 'Merch sale', 512)
    : clean(input.itemSummary || input.objectTitle || 'Tip', 512);
  const idSeed = clean(input.id || paymentId || orderId || referenceId || crypto.randomUUID(), 512);
  const metaObj = {
    ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
    sourceSite,
    provider,
    referenceId,
    paymentId,
    orderId,
    currency: input.currency || 'USD',
    amountCents
  };
  const cf = request?.cf || {};
  const ua = request?.headers?.get?.('user-agent') || '';

  await db.prepare(`INSERT OR IGNORE INTO analytics_events (
    id, created_at, event_type, page, title, session_id, visitor_id, referrer,
    object_type, object_id, object_title, seconds, percent, value, meta,
    country, region, city, timezone, device, user_agent
  ) VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    `commerce:${kind}:${idSeed}`,
    kind,
    page,
    sourceSite === 'setbliss' ? 'SetBliss commerce' : 'NoahGrove.com commerce',
    clean(input.sessionId || '', 80),
    clean(input.visitorId || '', 80),
    clean(input.referrer || '', 1024),
    'commerce',
    idSeed,
    itemTitle,
    null,
    null,
    Number.isFinite(amount) ? amount : amountCents / 100,
    JSON.stringify(metaObj),
    clean(input.country || cf.country || '', 20),
    clean(input.region || cf.region || '', 120),
    clean(input.city || cf.city || '', 120),
    clean(input.timezone || cf.timezone || '', 120),
    clean(input.device || detectDevice(ua), 40),
    clean(ua, 600)
  ).run();
  return { ok: true };
}

export async function publishCommerceEventToStats(env, input = {}) {
  if (!env.MAIN_STATS_COMMERCE_URL || !env.COMMERCE_TRACKING_SECRET) return { ok: false, skipped: true };
  const url = String(env.MAIN_STATS_COMMERCE_URL).replace(/\/+$/, '') || 'https://noahgrove.com/api/record-commerce-event';
  const endpoint = url.endsWith('/api/record-commerce-event') ? url : `${url}/api/record-commerce-event`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.COMMERCE_TRACKING_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error(`Commerce stats endpoint returned ${res.status}: ${await res.text().catch(()=>'')}`);
  return res.json().catch(() => ({ ok: true }));
}

export function commercePayloadFromTipEvent(tipEvent = {}, sourceSite = 'noahgrove') {
  return {
    kind: 'tip',
    id: tipEvent.id,
    amount: tipEvent.amount,
    amountCents: tipEvent.amountCents,
    currency: tipEvent.currency || 'USD',
    provider: tipEvent.provider || '',
    paymentId: tipEvent.paymentId || '',
    orderId: tipEvent.orderId || '',
    referenceId: tipEvent.referenceId || '',
    sourceSite,
    page: sourceSite === 'setbliss' ? '/request' : '/support',
    itemSummary: 'Tip',
    metadata: tipEvent.metadata || {}
  };
}

export function commercePayloadFromMerchEvent(merchEvent = {}, sourceSite = 'noahgrove') {
  return {
    kind: 'merch',
    id: merchEvent.id,
    amount: merchEvent.amount,
    amountCents: merchEvent.amountCents,
    currency: merchEvent.currency || 'USD',
    provider: merchEvent.provider || '',
    paymentId: merchEvent.paymentId || '',
    orderId: merchEvent.orderId || '',
    referenceId: merchEvent.referenceId || '',
    sourceSite,
    page: sourceSite === 'setbliss' ? '/request' : '/support',
    itemSummary: merchEvent.metadata?.order_summary || merchEvent.metadata?.item_summary || 'Merch sale',
    metadata: merchEvent.metadata || {}
  };
}

function getDb(env) { for (const name of DB_BINDING_NAMES) if (env[name] && typeof env[name].prepare === 'function') return env[name]; return null; }
async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS analytics_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, event_type TEXT NOT NULL, page TEXT, title TEXT, session_id TEXT, visitor_id TEXT, referrer TEXT, object_type TEXT, object_id TEXT, object_title TEXT, seconds REAL, percent REAL, value REAL, meta TEXT, country TEXT, region TEXT, city TEXT, timezone TEXT, device TEXT, user_agent TEXT)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_object ON analytics_events(object_type, object_id)`).run();
}
function detectSourceSite(source = '') { return String(source || '').toLowerCase().includes('setbliss') ? 'setbliss' : 'noahgrove'; }
function centsToDollars(cents) { const n = Number(cents); return Number.isFinite(n) ? n / 100 : 0; }
function detectDevice(ua = '') { const value = ua.toLowerCase(); if (/ipad|tablet/.test(value)) return 'tablet'; if (/mobi|iphone|android/.test(value)) return 'mobile'; if (value) return 'desktop'; return 'unknown'; }
function clean(value, max) { return String(value || '').slice(0, max); }
