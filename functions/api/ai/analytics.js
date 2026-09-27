import {aiAuthorized,json} from './_auth.js';
const DB_NAMES=['ANALYTICS_DB','DB','NOAH_ANALYTICS_DB'];
function db(env){for(const name of DB_NAMES)if(env[name]&&typeof env[name].prepare==='function')return env[name];return null}
export async function onRequestGet({request,env}){
  if(!aiAuthorized(request,env))return json({ok:false,error:'Unauthorized'},401);
  const database=db(env);if(!database)return json({ok:false,error:'Analytics database unavailable'},503);
  const url=new URL(request.url),days=Math.max(1,Math.min(365,Number.parseInt(url.searchParams.get('days')||'30',10)));
  await database.prepare('CREATE TABLE IF NOT EXISTS analytics_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, event_type TEXT NOT NULL, page TEXT, title TEXT, session_id TEXT, visitor_id TEXT, referrer TEXT, object_type TEXT, object_id TEXT, object_title TEXT, seconds REAL, percent REAL, value REAL, meta TEXT, country TEXT, region TEXT, city TEXT, timezone TEXT, device TEXT, user_agent TEXT)').run();
  const since=new Date(Date.now()-(days-1)*86400000).toISOString().slice(0,10);
  const summary=await database.prepare(`SELECT COUNT(*) events,COUNT(DISTINCT visitor_id) visitors,COUNT(DISTINCT session_id) sessions,SUM(CASE WHEN event_type='page_view' THEN 1 ELSE 0 END) page_views,SUM(CASE WHEN event_type='song_play' THEN 1 ELSE 0 END) song_plays,SUM(CASE WHEN event_type='song_download' THEN 1 ELSE 0 END) song_downloads,SUM(CASE WHEN event_type='youtube_play' THEN 1 ELSE 0 END) youtube_plays,SUM(CASE WHEN event_type='tip_paid' THEN 1 ELSE 0 END) tip_count,ROUND(SUM(CASE WHEN event_type='tip_paid' THEN COALESCE(value,0) ELSE 0 END),2) tip_total,SUM(CASE WHEN event_type='merch_paid' THEN 1 ELSE 0 END) merch_count,ROUND(SUM(CASE WHEN event_type='merch_paid' THEN COALESCE(value,0) ELSE 0 END),2) merch_total FROM analytics_events WHERE created_at>=?1`).bind(since).first();
  const topPages=(await database.prepare("SELECT page,COUNT(*) views,COUNT(DISTINCT visitor_id) visitors FROM analytics_events WHERE created_at>=?1 AND event_type='page_view' GROUP BY page ORDER BY views DESC LIMIT 10").bind(since).all()).results||[];
  const songs=(await database.prepare("SELECT object_title title,object_id id,SUM(CASE WHEN event_type='song_play' THEN 1 ELSE 0 END) plays,SUM(CASE WHEN event_type='song_complete' THEN 1 ELSE 0 END) completions FROM analytics_events WHERE created_at>=?1 AND object_type='song' GROUP BY object_id,object_title HAVING plays>0 OR completions>0 ORDER BY plays DESC LIMIT 20").bind(since).all()).results||[];
  return json({ok:true,days,since,summary:summary||{},top_pages:topPages,songs});
}
