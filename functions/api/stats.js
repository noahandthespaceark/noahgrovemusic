const DB_BINDING_NAMES = ["ANALYTICS_DB", "DB", "NOAH_ANALYTICS_DB"];

export async function onRequestGet({ request, env }) {
  try {
    const auth = authorize(request, env);
    if (!auth.ok) return json({ ok: false, error: auth.error, needsPassword: true }, auth.status);
    const db = getDb(env);
    if (!db) return json({ ok: false, error: "Missing D1 binding. Add ANALYTICS_DB to Cloudflare Pages." }, 500);
    await ensureSchema(db);

    const url = new URL(request.url);
    const days = Math.max(1, Math.min(365, Number.parseInt(url.searchParams.get("days") || "30", 10)));
    const since = `datetime('now', '-${days - 1} days', 'start of day')`;
    const bindSince = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

    const [summary, visitsByDay, topPages, referrers, devices, countries, songs, downloads, youtube, commerceSummary, commerceByDay, commerceBySource, commerceRecent, recent] = await Promise.all([
      first(db, `SELECT COUNT(*) events, COUNT(DISTINCT visitor_id) visitors, COUNT(DISTINCT session_id) sessions,
        SUM(CASE WHEN event_type='page_view' THEN 1 ELSE 0 END) page_views,
        SUM(CASE WHEN event_type='song_play' THEN 1 ELSE 0 END) song_plays,
        SUM(CASE WHEN event_type='song_download' THEN 1 ELSE 0 END) song_downloads,
        SUM(CASE WHEN event_type='youtube_play' THEN 1 ELSE 0 END) youtube_plays,
        SUM(CASE WHEN event_type='tip_paid' THEN 1 ELSE 0 END) tip_count,
        ROUND(SUM(CASE WHEN event_type='tip_paid' THEN COALESCE(value,0) ELSE 0 END),2) tip_total,
        SUM(CASE WHEN event_type='merch_paid' THEN 1 ELSE 0 END) merch_count,
        ROUND(SUM(CASE WHEN event_type='merch_paid' THEN COALESCE(value,0) ELSE 0 END),2) merch_total
        FROM analytics_events WHERE created_at >= ${since}`),
      all(db, `SELECT substr(created_at,1,10) day, COUNT(*) events,
        SUM(CASE WHEN event_type='page_view' THEN 1 ELSE 0 END) visits,
        COUNT(DISTINCT visitor_id) visitors,
        SUM(CASE WHEN event_type='song_play' THEN 1 ELSE 0 END) song_plays,
        SUM(CASE WHEN event_type='song_download' THEN 1 ELSE 0 END) downloads,
        ROUND(SUM(CASE WHEN event_type='tip_paid' THEN COALESCE(value,0) ELSE 0 END),2) tips,
        ROUND(SUM(CASE WHEN event_type='merch_paid' THEN COALESCE(value,0) ELSE 0 END),2) merch
        FROM analytics_events WHERE created_at >= ${since} GROUP BY day ORDER BY day`),
      all(db, `SELECT page, COUNT(*) views, COUNT(DISTINCT visitor_id) visitors FROM analytics_events WHERE created_at >= ${since} AND event_type='page_view' GROUP BY page ORDER BY views DESC LIMIT 15`),
      all(db, `SELECT CASE WHEN referrer='' THEN 'Direct / none' ELSE referrer END referrer, COUNT(*) visits FROM analytics_events WHERE created_at >= ${since} AND event_type='page_view' GROUP BY referrer ORDER BY visits DESC LIMIT 15`),
      all(db, `SELECT device, COUNT(*) events FROM analytics_events WHERE created_at >= ${since} GROUP BY device ORDER BY events DESC`),
      all(db, `SELECT COALESCE(NULLIF(country,''),'Unknown') country, COUNT(*) events FROM analytics_events WHERE created_at >= ${since} GROUP BY country ORDER BY events DESC LIMIT 15`),
      all(db, `SELECT object_title title, object_id id,
        SUM(CASE WHEN event_type='song_play' THEN 1 ELSE 0 END) plays,
        SUM(CASE WHEN event_type='song_complete' THEN 1 ELSE 0 END) completions,
        ROUND(AVG(CASE WHEN event_type='song_progress' THEN percent END),1) avg_progress,
        ROUND(SUM(CASE WHEN seconds IS NOT NULL THEN seconds ELSE 0 END),0) total_seconds
        FROM analytics_events WHERE created_at >= ${since} AND object_type='song' GROUP BY object_id, object_title HAVING plays > 0 OR completions > 0 ORDER BY plays DESC LIMIT 30`),
      all(db, `SELECT object_title title, object_id id, COUNT(*) downloads FROM analytics_events WHERE created_at >= ${since} AND event_type='song_download' GROUP BY object_id, object_title ORDER BY downloads DESC LIMIT 30`),
      all(db, `SELECT object_title title, object_id id,
        SUM(CASE WHEN event_type='youtube_play' THEN 1 ELSE 0 END) plays,
        ROUND(MAX(CASE WHEN event_type='youtube_progress' THEN seconds ELSE 0 END),0) max_seconds,
        ROUND(MAX(CASE WHEN event_type='youtube_progress' THEN percent ELSE 0 END),1) max_percent
        FROM analytics_events WHERE created_at >= ${since} AND object_type='youtube' GROUP BY object_id, object_title ORDER BY plays DESC LIMIT 20`),
      all(db, `SELECT
        SUM(CASE WHEN event_type='tip_paid' THEN 1 ELSE 0 END) tip_count,
        ROUND(SUM(CASE WHEN event_type='tip_paid' THEN COALESCE(value,0) ELSE 0 END),2) tip_total,
        SUM(CASE WHEN event_type='merch_paid' THEN 1 ELSE 0 END) merch_count,
        ROUND(SUM(CASE WHEN event_type='merch_paid' THEN COALESCE(value,0) ELSE 0 END),2) merch_total,
        ROUND(SUM(CASE WHEN event_type IN ('tip_paid','merch_paid') THEN COALESCE(value,0) ELSE 0 END),2) commerce_total
        FROM analytics_events WHERE created_at >= ${since}`),
      all(db, `SELECT substr(created_at,1,10) day,
        SUM(CASE WHEN event_type='tip_paid' THEN 1 ELSE 0 END) tip_count,
        ROUND(SUM(CASE WHEN event_type='tip_paid' THEN COALESCE(value,0) ELSE 0 END),2) tip_total,
        SUM(CASE WHEN event_type='merch_paid' THEN 1 ELSE 0 END) merch_count,
        ROUND(SUM(CASE WHEN event_type='merch_paid' THEN COALESCE(value,0) ELSE 0 END),2) merch_total
        FROM analytics_events WHERE created_at >= ${since} AND event_type IN ('tip_paid','merch_paid') GROUP BY day ORDER BY day`),
      all(db, `SELECT
        COALESCE(NULLIF(json_extract(meta,'$.sourceSite'),''), CASE WHEN page LIKE '%request%' THEN 'setbliss' ELSE 'noahgrove' END) source,
        SUM(CASE WHEN event_type='tip_paid' THEN 1 ELSE 0 END) tip_count,
        ROUND(SUM(CASE WHEN event_type='tip_paid' THEN COALESCE(value,0) ELSE 0 END),2) tip_total,
        SUM(CASE WHEN event_type='merch_paid' THEN 1 ELSE 0 END) merch_count,
        ROUND(SUM(CASE WHEN event_type='merch_paid' THEN COALESCE(value,0) ELSE 0 END),2) merch_total,
        ROUND(SUM(COALESCE(value,0)),2) total
        FROM analytics_events WHERE created_at >= ${since} AND event_type IN ('tip_paid','merch_paid') GROUP BY source ORDER BY total DESC`),
      all(db, `SELECT created_at, event_type,
        COALESCE(NULLIF(json_extract(meta,'$.sourceSite'),''), CASE WHEN page LIKE '%request%' THEN 'setbliss' ELSE 'noahgrove' END) source,
        object_title item, ROUND(value,2) amount,
        json_extract(meta,'$.provider') provider,
        json_extract(meta,'$.referenceId') reference
        FROM analytics_events WHERE created_at >= ${since} AND event_type IN ('tip_paid','merch_paid') ORDER BY created_at DESC LIMIT 50`),
      all(db, `SELECT created_at, event_type, page, object_title, seconds, percent, country, region, city, device FROM analytics_events WHERE created_at >= ${since} ORDER BY created_at DESC LIMIT 50`)
    ]);

    return json({ ok: true, days, since: bindSince, summary, visitsByDay, topPages, referrers, devices, countries, songs, downloads, youtube, commerceSummary, commerceByDay, commerceBySource, commerceRecent, recent, passwordEnabled: Boolean(env.STATS_PASSWORD) });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Unable to load stats." }, 500);
  }
}

function authorize(request, env) {
  if (!env.STATS_PASSWORD) return { ok: true };
  const url = new URL(request.url);
  const provided = request.headers.get("x-stats-password") || url.searchParams.get("password") || "";
  return provided === env.STATS_PASSWORD ? { ok: true } : { ok: false, status: 401, error: "Stats password required." };
}
function getDb(env) { for (const name of DB_BINDING_NAMES) if (env[name] && typeof env[name].prepare === "function") return env[name]; return null; }
async function ensureSchema(db) { await db.prepare(`CREATE TABLE IF NOT EXISTS analytics_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, event_type TEXT NOT NULL, page TEXT, title TEXT, session_id TEXT, visitor_id TEXT, referrer TEXT, object_type TEXT, object_id TEXT, object_title TEXT, seconds REAL, percent REAL, value REAL, meta TEXT, country TEXT, region TEXT, city TEXT, timezone TEXT, device TEXT, user_agent TEXT)`).run(); }
async function all(db, sql) { return (await db.prepare(sql).all()).results || []; }
async function first(db, sql) { return (await db.prepare(sql).first()) || {}; }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
