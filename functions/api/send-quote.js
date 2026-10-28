import {estimate,sameSite,text,limited} from './_quote.js';
import {quoteMailConfig,sendQuoteMail,validEmail} from './_quote-mail.js';
export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if(!sameSite(request))return json({ok:false,error:'Use the quote form on this website.'},403);
    if(limited(request,'send',5))return json({ok:false,error:'Too many requests. Please wait a minute.'},429);
    const raw=await request.text();
    if(raw.length>16000)return json({ok:false,error:'Request too large.'},413);
    let input;try{input=JSON.parse(raw);}catch{return json({ok:false,error:'Invalid request.'},400);}
    if(!input||typeof input!=='object'||Array.isArray(input))return json({ok:false,error:'Invalid request.'},400);
    const body={};
    for(const field of ['fullName','email','phone','venueName','destination','eventDate','startTime','submissionId'])body[field]=text(input[field],field==='destination'?300:200);
    body.notes=text(input.notes,5000);body.eventDetails=body.notes;
    body.hours=input.hours??2;body.songCount=input.songCount??0;body.setups=input.setups??1;
    body.bookingEmail='noah@noahgrove.com';
    body.eventDateFormatted=body.eventDate||'Not provided';body.startTimeFormatted=body.startTime||'Not provided';
    if(/[\r\n\x00-\x1f\x7f]/.test(body.fullName+body.venueName+body.eventDate+body.startTime)||
      (body.eventDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(body.eventDate)||!Number.isFinite(Date.parse(body.eventDate))||new Date(body.eventDate).toISOString().slice(0,10)!==body.eventDate))||
      (body.startTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.startTime)))return json({ok:false,error:'Please check the event date, time, and contact details.'},400);
    if(body.eventDate)body.eventDateFormatted=new Intl.DateTimeFormat('en-US',{dateStyle:'full',timeZone:'UTC'}).format(new Date(body.eventDate));
    if(body.startTime){const [hours,minutes]=body.startTime.split(':');body.startTimeFormatted=`${Number(hours)%12||12}:${minutes} ${Number(hours)<12?'AM':'PM'} (venue local time)`;}
    // Stable per-submission email keys support safe provider retries without accepting browser totals.
    const identity=JSON.stringify([body.submissionId,body.fullName,body.email,body.phone,body.venueName,body.destination,body.eventDate,body.startTime,body.hours,body.songCount,body.setups,body.notes]);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)))).map(b=>b.toString(16).padStart(2,'0')).join('');
    body.reference='NQ-'+digest.slice(0,12).toUpperCase();

    const required = ["fullName", "email", "phone"];
    for (const field of required) {
      if (!String(body[field] || "").trim()) {
        return json(
          { ok: false, error: `Missing required field: ${field}` },
          400
        );
      }
    }

    if (!validEmail(body.email)) {
      return json({ ok: false, error: "Invalid customer email address." }, 400);
    }

    const mail=quoteMailConfig(env);
    if(!mail.ready)return json({ok:false,code:'email_not_configured',error:'Online quote email is temporarily unavailable. Please email noah@noahgrove.com with your event details.'},503);

    let pricing;try{pricing=await estimate(body,env);}catch{return json({ok:false,error:'Choose valid event details.'},400);}
    Object.assign(body,pricing);

    const adminSubject = `New Quote Request${
      body.venueName ? ` – ${body.venueName}` : ""
    }${body.eventDate ? ` – ${body.eventDate}` : ""}`;

    const customerSubject = "Your Noah Grove Music quote request";

    const adminHtml = buildAdminHtml(body);
    const customerHtml = buildCustomerHtml(body);

    const adminText = buildAdminText(body);
    const customerText = buildCustomerText(body);

    // Email to Noah
    const adminRes = await sendQuoteMail(mail,{
        from: mail.from,
        to: [mail.to],
        reply_to: body.email,
        subject: adminSubject,
        html: adminHtml,
        text: adminText
      },'quote-admin-'+digest);

    if (!adminRes.accepted) {
      return json(
        {
          ok: false,
          reference:body.reference,code:adminRes.code,emailOutcome:adminRes.outcome,
          error: "Could not confirm delivery to Noah. Please contact noah@noahgrove.com before resubmitting."
        },
        502
      );
    }

    // Confirmation email to customer
    const customerRes = await sendQuoteMail(mail,{
        from: mail.from,
        to: [body.email],
        reply_to: mail.replyTo,
        subject: customerSubject,
        html: customerHtml,
        text: customerText
      },'quote-customer-'+digest);

    const gigDashboardResult = await addToGigDashboardPossibleClients(body, env);

    return json({
      ok: true,
      reference:body.reference,
      ownerEmailAccepted:true,
      customerConfirmation:customerRes.accepted,
      customerEmailOutcome:customerRes.outcome,
      customerEmailCode:customerRes.code,
      estimate:pricing,
      gigDashboard: gigDashboardResult
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Could not confirm delivery. Please contact noah@noahgrove.com before resubmitting."
      },
      500
    );
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function esc(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value) {
  if(value===null)return 'Pending confirmation';
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function totalLabel(data){return data.total===null?'Subtotal — travel not included':'Estimated Total';}
function totalMoney(data){return money(data.total??data.subtotal);}

function row(label, value) {
  return `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e9e9e9;font-weight:600;width:220px;vertical-align:top;">
        ${esc(label)}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e9e9e9;">
        ${esc(value)}
      </td>
    </tr>
  `;
}

function moneyRow(label, value, show = true) {
  if (!show) return "";
  return row(label, money(value));
}

async function addToGigDashboardPossibleClients(data, env) {
  const endpoint = env.GIGDASHBOARD_POSSIBLE_CLIENTS_URL || env.GIGDASHBOARD_API_URL;

  if (!endpoint) {
    return {
      ok: false,
      skipped: true,
      reason: "Missing GIGDASHBOARD_POSSIBLE_CLIENTS_URL. Emails were still sent."
    };
  }

  const possibleClient = {
    source: "NoahGrove.com estimate popup",
    status: "possible",
    name: data.fullName || "",
    email: data.email || "",
    phone: data.phone || "",
    eventDate: data.eventDate || "",
    eventDateFormatted: data.eventDateFormatted || "",
    startTime: data.startTime || "",
    startTimeFormatted: data.startTimeFormatted || "",
    venueName: data.venueName || "",
    venueAddress: data.destination || "",
    eventDetails: data.eventDetails || data.notes || "",
    liveMusicHours: Number(data.hours || 0),
    newSongsRequested: Number(data.songCount || 0),
    setupLocations: Number(data.setups || 1),
    estimate: {
      performance: Number(data.performance || 0),
      newSongs: Number(data.songs || 0),
      additionalSetups: Number(data.setupsCost || 0),
      travel: data.travel,
      total: data.total,
      travelMeta: data.travelMeta || "",
      travelStatus:data.travelStatus,subtotal:data.subtotal
    },
    notes: data.notes || "",
    submittedAt: new Date().toISOString()
  };

  try {
    const headers = {
      "Content-Type": "application/json"
    };

    if (env.GIGDASHBOARD_API_KEY) {
      headers.Authorization = `Bearer ${env.GIGDASHBOARD_API_KEY}`;
      headers["X-API-Key"] = env.GIGDASHBOARD_API_KEY;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(possibleClient),signal:AbortSignal.timeout(8000),redirect:'manual'
    });

    await response.body?.cancel();

    return {
      ok: response.ok,
      status: response.status
    };
  } catch (error) {
    return {
      ok: false,
      error: "Lead capture could not be confirmed."
    };
  }
}

function buildAdminHtml(data) {
  return `
  <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5;max-width:760px;margin:0 auto;">
    <h2 style="margin:0 0 16px;">New Quote Request</h2>
    <p style="color:#666;">Noah Grove Music · Reference ${esc(data.reference)}</p>

    <div style="background:#f7f7f7;border:1px solid #e8e8e8;border-radius:12px;padding:16px;margin-bottom:18px;">
      <div style="font-size:13px;color:#666;margin-bottom:6px;">${totalLabel(data)}</div>
      <div style="font-size:32px;font-weight:700;">${totalMoney(data)}</div>
    </div>

    <h3 style="margin:24px 0 10px;">Contact Info</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e9e9e9;border-radius:10px;overflow:hidden;">
      ${row("Name", data.fullName || "Not provided")}
      ${row("Email", data.email || "Not provided")}
      ${row("Phone", data.phone || "Not provided")}
    </table>

    <h3 style="margin:24px 0 10px;">Event Details</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e9e9e9;border-radius:10px;overflow:hidden;">
      ${row("Venue Name", data.venueName || "Not provided")}
      ${row("Venue Address", data.destination || "Not provided")}
      ${row("Event Date", data.eventDateFormatted || "Not provided")}
      ${row("Start Time", data.startTimeFormatted || "Not provided")}
      ${row("Live Music Hours", String(data.hours || "Not provided"))}
      ${row("New Songs Requested", String(data.songCount ?? 0))}
      ${row("Setup Locations", String(data.setups ?? 1))}
      ${row("Travel Details", data.travelMeta || "Not provided")}
    </table>

    <h3 style="margin:24px 0 10px;">Estimate Breakdown</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e9e9e9;border-radius:10px;overflow:hidden;">
      ${moneyRow("Performance", data.performance)}
      ${moneyRow("New Songs", data.songs, Number(data.songs) > 0)}
      ${moneyRow("Additional Setups", data.setupsCost, Number(data.setupsCost) > 0)}
      ${moneyRow("Travel", data.travel, true)}
      ${row(totalLabel(data), totalMoney(data))}
    </table>

    ${
      data.notes
        ? `
      <h3 style="margin:24px 0 10px;">Event Details</h3>
      <div style="border:1px solid #e9e9e9;border-radius:10px;padding:14px;background:#fcfcfc;white-space:pre-wrap;">${esc(data.notes)}</div>
    `
        : ""
    }
  </div>
  `;
}

function buildCustomerHtml(data) {
  return `
  <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5;max-width:760px;margin:0 auto;">
    <h2 style="margin:0 0 12px;">Thanks for your quote request</h2>
    <p style="color:#666;">Noah Grove Music · Reference ${esc(data.reference)}</p>
    <p style="margin:0 0 18px;">Hi ${esc(data.fullName || "")}, I received your request and will follow up with you soon.</p>

    <div style="background:#f7f7f7;border:1px solid #e8e8e8;border-radius:12px;padding:16px;margin-bottom:18px;">
      <div style="font-size:13px;color:#666;margin-bottom:6px;">${totalLabel(data)}</div>
      <div style="font-size:32px;font-weight:700;">${totalMoney(data)}</div>
      <p>${esc(data.travelMeta)}</p>
      <div style="font-size:12px;color:#666;margin-top:8px;">
        This is an estimate, not a confirmed booking or reservation. Availability and final pricing must be confirmed with Noah.
      </div>
    </div>

    <h3 style="margin:24px 0 10px;">Estimate Breakdown</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e9e9e9;">
      ${moneyRow('Performance',data.performance)}
      ${moneyRow('New Songs',data.songs)}
      ${moneyRow('Additional Setups',data.setupsCost)}
      ${moneyRow('Travel',data.travel)}
      ${row(totalLabel(data),totalMoney(data))}
    </table>
    <h3 style="margin:24px 0 10px;">Your Submitted Details</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e9e9e9;border-radius:10px;overflow:hidden;">
      ${row("Venue Name", data.venueName || "Not provided")}
      ${row("Venue Address", data.destination || "Not provided")}
      ${row("Event Date", data.eventDateFormatted || "Not provided")}
      ${row("Start Time", data.startTimeFormatted || "Not provided")}
      ${row("Live Music Hours", String(data.hours || "Not provided"))}
      ${row("New Songs Requested", String(data.songCount ?? 0))}
      ${row("Setup Locations", String(data.setups ?? 1))}
    </table>

    ${
      data.notes
        ? `
      <h3 style="margin:24px 0 10px;">Event Details</h3>
      <div style="border:1px solid #e9e9e9;border-radius:10px;padding:14px;background:#fcfcfc;white-space:pre-wrap;">${esc(data.notes)}</div>
    `
        : ""
    }

    <p style="margin-top:24px;">Reply to this email or contact Noah at ${esc(data.bookingEmail || "noah@noahgrove.com")}.</p>
  </div>
  `;
}

function buildAdminText(data) {
  return [
    "NEW QUOTE REQUEST",
    `Reference: ${data.reference}`,
    "",
    `${totalLabel(data)}: ${totalMoney(data)}`,
    "",
    "CONTACT INFO",
    `Name: ${data.fullName || "Not provided"}`,
    `Email: ${data.email || "Not provided"}`,
    `Phone: ${data.phone || "Not provided"}`,
    "",
    "EVENT DETAILS",
    `Venue Name: ${data.venueName || "Not provided"}`,
    `Venue Address: ${data.destination || "Not provided"}`,
    `Event Date: ${data.eventDateFormatted || "Not provided"}`,
    `Start Time: ${data.startTimeFormatted || "Not provided"}`,
    `Live Music Hours: ${data.hours || "Not provided"}`,
    `New Songs Requested: ${data.songCount ?? 0}`,
    `Setup Locations: ${data.setups ?? 1}`,
    `Travel Details: ${data.travelMeta || "Not provided"}`,
    "",
    "ESTIMATE BREAKDOWN",
    `Performance: ${money(data.performance)}`,
    ...(Number(data.songs) > 0 ? [`New Songs: ${money(data.songs)}`] : []),
    ...(Number(data.setupsCost) > 0 ? [`Additional Setups: ${money(data.setupsCost)}`] : []),
    `Travel: ${money(data.travel)}`,
    `${totalLabel(data)}: ${totalMoney(data)}`,
    data.travelMeta,
    ...(data.notes ? ["", "EVENT DETAILS", data.notes] : [])
  ].join("\n");
}

function buildCustomerText(data) {
  return [
    `Hi ${data.fullName || ""},`,
    "",
    "Thanks for your quote request. I received it and will follow up with you soon.",
    `Reference: ${data.reference}`,
    "",
    `${totalLabel(data)}: ${totalMoney(data)}`,
    data.travelMeta,
    "",
    `Performance: ${money(data.performance)}`,
    `New Songs: ${money(data.songs)}`,
    `Additional Setups: ${money(data.setupsCost)}`,
    `Travel: ${money(data.travel)}`,
    `Venue: ${data.venueName || 'Not provided'}`,
    `Address: ${data.destination || 'Not provided'}`,
    `Date: ${data.eventDateFormatted}`,
    `Start: ${data.startTimeFormatted}`,
    `Hours: ${data.hours}; new songs requested: ${data.songCount}; setup locations: ${data.setups}`,
    ...(data.notes?['',data.notes]:[]),
    '',
    'This is an estimate, not a confirmed booking or reservation. Availability and final pricing must be confirmed with Noah.',
    `Reply to this email or contact ${data.bookingEmail}.`
  ].join("\n");
}
