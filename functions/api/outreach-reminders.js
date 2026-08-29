const DB_BINDING_NAMES = ["OUTREACH_DB", "ANALYTICS_DB", "DB", "NOAH_ANALYTICS_DB"];
const TIME_ZONE = "America/New_York";

export async function onRequestPost({ request, env }) {
  try {
    const provided = request.headers.get("x-outreach-reminder-token") || "";
    const expected = String(env.OUTREACH_REMINDER_TOKEN || "");
    if (!expected) return json({ ok:false, error:"OUTREACH_REMINDER_TOKEN is not configured." }, 503);
    if (!timingSafeEqual(provided, expected)) return json({ ok:false, error:"Unauthorized." }, 401);

    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const now = new Date();
    const local = localParts(now);
    if (!force && local.hour !== 8) {
      return json({ ok:true, skipped:true, reason:`Outside 8 AM ${TIME_ZONE} window.`, local });
    }

    const db = getDb(env);
    if (!db) return json({ ok:false, error:"Missing D1 binding." }, 500);
    await ensureSchema(db);

    const due = (await db.prepare(`
      SELECT c.*,
        (SELECT MAX(a.happened_at) FROM outreach_activity a WHERE a.contact_id=c.id) AS last_activity
      FROM outreach_contacts c
      WHERE COALESCE(c.archived,0)=0
        AND TRIM(COALESCE(c.next_follow_up,'')) <> ''
        AND c.next_follow_up <= ?
        AND COALESCE(c.status,'') NOT IN ('Completed','Not interested')
        AND COALESCE(c.follow_up_reminder_sent_for,'') <> c.next_follow_up
      ORDER BY c.next_follow_up ASC,
        CASE c.priority WHEN 'TOP PRIORITY' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END,
        c.name ASC
    `).bind(local.date).all()).results || [];

    if (!due.length) return json({ ok:true, sent:false, due:0, localDate:local.date });

    if (!env.RESEND_API_KEY) return json({ ok:false, error:"Missing RESEND_API_KEY." }, 500);
    const to = String(env.OUTREACH_REMINDER_EMAIL || env.QUOTE_TO_EMAIL || "").trim();
    const from = String(env.OUTREACH_REMINDER_FROM_EMAIL || env.QUOTE_FROM_EMAIL || "").trim();
    if (!to) return json({ ok:false, error:"Missing OUTREACH_REMINDER_EMAIL (or QUOTE_TO_EMAIL fallback)." }, 500);
    if (!from) return json({ ok:false, error:"Missing OUTREACH_REMINDER_FROM_EMAIL (or QUOTE_FROM_EMAIL fallback)." }, 500);

    const histories = {};
    for (const contact of due) {
      histories[contact.id] = (await db.prepare(`
        SELECT type,happened_at,details FROM outreach_activity
        WHERE contact_id=? ORDER BY happened_at DESC,id DESC LIMIT 6
      `).bind(contact.id).all()).results || [];
    }

    const subject = due.length === 1
      ? `Outreach follow-up reminder — ${due[0].name}`
      : `${due.length} outreach follow-ups due — ${formatHumanDate(local.date)}`;
    const html = buildHtml(due, histories, local.date);
    const text = buildText(due, histories, local.date);

    const emailRes = await fetch("https://api.resend.com/emails", {
      method:"POST",
      headers:{ Authorization:`Bearer ${env.RESEND_API_KEY}`, "Content-Type":"application/json" },
      body:JSON.stringify({ from, to:[to], subject, html, text })
    });
    const emailData = await emailRes.json().catch(()=>({}));
    if (!emailRes.ok) return json({ ok:false, error:"Resend rejected the reminder email.", details:emailData }, 502);

    const sentAt = new Date().toISOString();
    for (const contact of due) {
      await db.prepare(`UPDATE outreach_contacts SET follow_up_reminder_sent_for=next_follow_up, follow_up_reminder_sent_at=?, updated_at=datetime('now') WHERE id=?`).bind(sentAt, contact.id).run();
      await db.prepare(`INSERT INTO outreach_activity(contact_id,type,happened_at,details) VALUES(?,?,?,?)`).bind(contact.id,"reminder_sent",sentAt,`Automatic follow-up reminder emailed for ${contact.next_follow_up}.`).run();
    }

    return json({ ok:true, sent:true, due:due.length, emailId:emailData?.id || null, localDate:local.date });
  } catch (error) {
    return json({ ok:false, error:error?.message || "Unable to process outreach reminders." }, 500);
  }
}

function buildHtml(contacts, histories, today) {
  const blocks = contacts.map(c => {
    const overdue = c.next_follow_up < today;
    const history = (histories[c.id] || []).map(a => `<li style="margin:4px 0"><strong>${esc(typeLabel(a.type))}</strong> — ${esc(formatDateTime(a.happened_at))}${a.details ? `<br><span style="color:#555">${esc(a.details)}</span>` : ""}</li>`).join("") || '<li>No communication logged yet.</li>';
    return `<section style="border:1px solid #ddd;border-radius:14px;padding:18px;margin:16px 0;background:#fff">
      <div style="font-size:12px;font-weight:700;color:#8b642a;text-transform:uppercase">${esc(c.priority || '')} · ${esc(c.category || '')}</div>
      <h2 style="margin:6px 0 8px;font-size:20px;color:#17202a">${esc(c.name)}</h2>
      <p style="margin:6px 0"><strong>Follow-up:</strong> ${esc(formatHumanDate(c.next_follow_up))}${overdue ? ' <strong style="color:#b33">(overdue)</strong>' : ''}</p>
      <p style="margin:6px 0"><strong>Status:</strong> ${esc(c.status || 'Not contacted')}</p>
      ${c.email ? `<p style="margin:6px 0"><strong>Email:</strong> <a href="mailto:${escAttr(c.email)}">${esc(c.email)}</a></p>` : ''}
      ${c.phone ? `<p style="margin:6px 0"><strong>Phone:</strong> <a href="tel:${escAttr(c.phone)}">${esc(c.phone)}</a></p>` : ''}
      ${c.contact ? `<p style="margin:6px 0"><strong>Contact details:</strong> ${esc(c.contact)}</p>` : ''}
      ${c.location ? `<p style="margin:6px 0"><strong>Location:</strong> ${esc(c.location)}</p>` : ''}
      ${c.best_ask ? `<p style="margin:10px 0"><strong>Best approach:</strong> ${esc(c.best_ask)}</p>` : ''}
      ${c.fit ? `<p style="margin:10px 0"><strong>Why it fits:</strong> ${esc(c.fit)}</p>` : ''}
      ${c.notes ? `<p style="margin:10px 0"><strong>Your notes:</strong><br>${nl2br(esc(c.notes))}</p>` : ''}
      ${c.caution ? `<p style="margin:10px 0"><strong>Sensitivity note:</strong> ${esc(c.caution)}</p>` : ''}
      ${c.source_url ? `<p style="margin:10px 0"><a href="${escAttr(c.source_url)}">Reference page</a></p>` : ''}
      <div style="margin-top:14px"><strong>Recent history</strong><ul style="padding-left:20px">${history}</ul></div>
      <p style="margin-top:16px"><a href="https://noahgrove.com/outreach" style="display:inline-block;padding:10px 14px;border-radius:9px;background:#dca64d;color:#201407;text-decoration:none;font-weight:700">Open outreach tracker</a></p>
    </section>`;
  }).join("");
  return `<!doctype html><html><body style="margin:0;background:#f4f3ef;font-family:Arial,sans-serif;color:#222"><div style="max-width:760px;margin:auto;padding:28px 18px"><h1 style="margin:0">Outreach follow-up reminder</h1><p style="color:#666">${contacts.length === 1 ? 'One outreach follow-up needs your attention.' : `${contacts.length} outreach follow-ups need your attention.`}</p>${blocks}<p style="font-size:12px;color:#777">This reminder was generated automatically from noahgrove.com/outreach. Setting a new follow-up date will schedule a new reminder.</p></div></body></html>`;
}

function buildText(contacts, histories, today) {
  const out = [`OUTREACH FOLLOW-UP REMINDER`, `${contacts.length} follow-up${contacts.length===1?'':'s'} due`, ``];
  for (const c of contacts) {
    out.push(`==============================`, c.name, `${c.priority || ''} | ${c.category || ''}`, `Follow-up: ${formatHumanDate(c.next_follow_up)}${c.next_follow_up < today ? ' (OVERDUE)' : ''}`, `Status: ${c.status || 'Not contacted'}`);
    if (c.email) out.push(`Email: ${c.email}`); if (c.phone) out.push(`Phone: ${c.phone}`); if (c.contact) out.push(`Contact details: ${c.contact}`); if (c.location) out.push(`Location: ${c.location}`); if (c.best_ask) out.push(`Best approach: ${c.best_ask}`); if (c.fit) out.push(`Why it fits: ${c.fit}`); if (c.notes) out.push(`Your notes: ${c.notes}`); if (c.caution) out.push(`Sensitivity note: ${c.caution}`); if (c.source_url) out.push(`Reference: ${c.source_url}`);
    out.push(`Recent history:`); const h=histories[c.id]||[]; if (!h.length) out.push(`- No communication logged yet.`); else h.forEach(a=>out.push(`- ${typeLabel(a.type)} — ${formatDateTime(a.happened_at)}${a.details ? ` — ${a.details}` : ''}`)); out.push('');
  }
  out.push('Open tracker: https://noahgrove.com/outreach'); return out.join('\n');
}

function localParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return { date:`${parts.year}-${parts.month}-${parts.day}`, hour:Number(parts.hour) };
}
function formatHumanDate(v) { if(!v) return ''; const [y,m,d]=v.split('-').map(Number); return new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'America/New_York'}).format(new Date(Date.UTC(y,m-1,d,12))); }
function formatDateTime(v) { if(!v) return ''; const d=new Date(v); return Number.isNaN(d.getTime())?String(v):new Intl.DateTimeFormat('en-US',{timeZone:TIME_ZONE,month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d); }
function typeLabel(t){ return ({email_sent:'Email sent',call_made:'Call made',response_received:'Response received',spoke:'Spoke',meeting:'Meeting / opportunity',note:'Note',other:'Other',reminder_sent:'Follow-up reminder sent'})[t] || t; }
function getDb(env) { for (const n of DB_BINDING_NAMES) if (env[n] && typeof env[n].prepare === 'function') return env[n]; return null; }
async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS outreach_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, seed_key TEXT UNIQUE, name TEXT NOT NULL, category TEXT, priority TEXT, fit TEXT, contact TEXT, email TEXT, phone TEXT, location TEXT, best_ask TEXT, caution TEXT, source_url TEXT, status TEXT DEFAULT 'Not contacted', next_follow_up TEXT, notes TEXT, archived INTEGER DEFAULT 0, follow_up_reminder_sent_for TEXT, follow_up_reminder_sent_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();
  const columns=(await db.prepare(`PRAGMA table_info(outreach_contacts)`).all()).results||[]; const names=new Set(columns.map(c=>c.name));
  if(!names.has('follow_up_reminder_sent_for')) await db.prepare(`ALTER TABLE outreach_contacts ADD COLUMN follow_up_reminder_sent_for TEXT`).run();
  if(!names.has('follow_up_reminder_sent_at')) await db.prepare(`ALTER TABLE outreach_contacts ADD COLUMN follow_up_reminder_sent_at TEXT`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS outreach_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER NOT NULL, type TEXT NOT NULL, happened_at TEXT NOT NULL, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(contact_id) REFERENCES outreach_contacts(id) ON DELETE CASCADE)`).run();
}
function timingSafeEqual(a,b){ if(a.length!==b.length)return false; let x=0; for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i); return x===0; }
function esc(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escAttr(v){ return esc(v); } function nl2br(v){ return String(v).replace(/\n/g,'<br>'); }
function json(data,status=200){ return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}}); }
