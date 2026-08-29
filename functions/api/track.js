const DB_BINDING_NAMES = ["ANALYTICS_DB", "DB", "NOAH_ANALYTICS_DB"];

export async function onRequestPost({ request, env }) {
  try {
    const db = getDb(env);
    if (!db) return json({ ok: false, error: "Missing D1 binding. Add ANALYTICS_DB to Cloudflare Pages." }, 500);
    await ensureSchema(db);

    const body = await request.json().catch(() => ({}));
    const eventType = clean(body.eventType || body.type || "event", 64);
    const page = clean(body.page || new URL(request.url).pathname, 512);
    const title = clean(body.title || "", 256);
    const sessionId = clean(body.sessionId || "", 80);
    const visitorId = clean(body.visitorId || "", 80);
    const referrer = clean(body.referrer || "", 1024);
    const objectType = clean(body.objectType || "", 80);
    const objectId = clean(body.objectId || "", 512);
    const objectTitle = clean(body.objectTitle || "", 512);
    const seconds = finiteNumber(body.seconds);
    const percent = finiteNumber(body.percent);
    const value = finiteNumber(body.value);
    const meta = JSON.stringify(body.meta && typeof body.meta === "object" ? body.meta : {});
    const ua = request.headers.get("user-agent") || "";
    const cf = request.cf || {};

    await db.prepare(`INSERT INTO analytics_events (
      id, created_at, event_type, page, title, session_id, visitor_id, referrer,
      object_type, object_id, object_title, seconds, percent, value, meta,
      country, region, city, timezone, device, user_agent
    ) VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(), eventType, page, title, sessionId, visitorId, referrer,
      objectType, objectId, objectTitle, seconds, percent, value, meta,
      clean(cf.country || "", 20), clean(cf.region || "", 120), clean(cf.city || "", 120), clean(cf.timezone || "", 120),
      detectDevice(ua), clean(ua, 600)
    ).run();

    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Unable to track event." }, 500);
  }
}

function getDb(env) {
  for (const name of DB_BINDING_NAMES) if (env[name] && typeof env[name].prepare === "function") return env[name];
  return null;
}

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    event_type TEXT NOT NULL,
    page TEXT,
    title TEXT,
    session_id TEXT,
    visitor_id TEXT,
    referrer TEXT,
    object_type TEXT,
    object_id TEXT,
    object_title TEXT,
    seconds REAL,
    percent REAL,
    value REAL,
    meta TEXT,
    country TEXT,
    region TEXT,
    city TEXT,
    timezone TEXT,
    device TEXT,
    user_agent TEXT
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_object ON analytics_events(object_type, object_id)`).run();
}

function detectDevice(ua = "") {
  const value = ua.toLowerCase();
  if (/ipad|tablet/.test(value)) return "tablet";
  if (/mobi|iphone|android/.test(value)) return "mobile";
  if (value) return "desktop";
  return "unknown";
}
function finiteNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function clean(value, max) { return String(value || "").slice(0, max); }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
