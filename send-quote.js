export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders()
    });
  }

  if (request.method !== "POST") {
    return json(
      { ok: false, error: "Method not allowed" },
      405
    );
  }

  return onRequestPost(context);
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body." }, 400);
    }

    const required = [
      "fullName",
      "email",
      "phone",
      "eventDate",
      "startTime",
      "hours",
      "venueName",
      "venueAddress",
      "estimatedTotal"
    ];

    for (const field of required) {
      if (!String(data[field] ?? "").trim()) {
        return json({ ok: false, error: `Missing field: ${field}` }, 400);
      }
    }

    const resendApiKey = String(env.RESEND_API_KEY || "").trim();
    const rawFromEmail = String(env.FROM_EMAIL || "info@noahgrove.com").trim();
    const rawOwnerEmail = String(env.TO_EMAIL || "info@noahgrove.com").trim();

    const customerEmail = extractEmail(data.email);
    const fromEmailAddress = extractEmail(rawFromEmail);
    const ownerEmailAddress = extractEmail(rawOwnerEmail);

    if (!resendApiKey) {
      return json({ ok: false, error: "Missing RESEND_API_KEY." }, 500);
    }

    if (!isValidEmail(fromEmailAddress)) {
      return json({ ok: false, error: "FROM_EMAIL is invalid." }, 500);
    }

    if (!isValidEmail(ownerEmailAddress)) {
      return json({ ok: false, error: "TO_EMAIL is invalid." }, 500);
    }

    if (!isValidEmail(customerEmail)) {
      return json({ ok: false, error: "Customer email is invalid." }, 400);
    }

    const fromHeader = rawFromEmail.includes("<")
      ? rawFromEmail
      : `Noah Grove Music <${fromEmailAddress}>`;

    const ownerHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5;">
        <h2 style="margin:0 0 16px;">New Quote Request</h2>

        <table style="border-collapse:collapse;width:100%;max-width:700px;">
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Name</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(data.fullName)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Email</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(customerEmail)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Phone</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(data.phone)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Event date</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(data.eventDate)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Start time</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(data.startTime)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Live music hours</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(data.hours)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Wireless mic</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${yesNo(data.wirelessMic)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>New songs requested</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(data.songs || "0")}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Setup locations</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(data.setups || "1")}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Venue name</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(data.venueName)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Venue address</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(data.venueAddress)}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Travel</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(data.travelPlain || data.travelNote || "")}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #ddd;"><strong>Estimated total</strong></td><td style="padding:8px;border-bottom:1px solid #ddd;font-size:18px;"><strong>${escapeHtml(data.estimatedTotal)}</strong></td></tr>
          <tr><td style="padding:8px;vertical-align:top;"><strong>Notes</strong></td><td style="padding:8px;white-space:pre-wrap;">${escapeHtml(data.notes || "")}</td></tr>
        </table>
      </div>
    `;

    const ownerText = [
      "New Quote Request",
      "",
      `Name: ${data.fullName}`,
      `Email: ${customerEmail}`,
      `Phone: ${data.phone}`,
      `Event date: ${data.eventDate}`,
      `Start time: ${data.startTime}`,
      `Live music hours: ${data.hours}`,
      `Wireless mic: ${yesNo(data.wirelessMic)}`,
      `New songs requested: ${data.songs || "0"}`,
      `Setup locations: ${data.setups || "1"}`,
      `Venue name: ${data.venueName}`,
      `Venue address: ${data.venueAddress}`,
      `Travel: ${data.travelPlain || data.travelNote || ""}`,
      `Estimated total: ${data.estimatedTotal}`,
      `Notes: ${data.notes || ""}`
    ].join("\n");

    const resendPayload = {
      from: fromHeader,
      to: [ownerEmailAddress],
      subject: `Quote Request — ${data.fullName} — ${data.eventDate}`,
      html: ownerHtml,
      text: ownerText,
      reply_to: customerEmail
    };

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(resendPayload)
    });

    const resendText = await resendResponse.text();
    let resendJson = {};
    try {
      resendJson = resendText ? JSON.parse(resendText) : {};
    } catch {
      resendJson = { raw: resendText };
    }

    if (!resendResponse.ok) {
      return json(
        {
          ok: false,
          error:
            resendJson?.message ||
            resendJson?.error ||
            resendJson?.raw ||
            "Failed to send quote email."
        },
        500
      );
    }

    return json({
      ok: true,
      emailId: resendJson.id || null
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error?.message || "Unknown server error."
      },
      500
    );
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Allow": "POST, OPTIONS"
  };
}

function extractEmail(value) {
  const raw = String(value ?? "").trim();
  const angleMatch = raw.match(/<\s*([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)\s*>/);
  return angleMatch ? angleMatch[1].trim() : raw;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function yesNo(v) {
  return v ? "Yes" : "No";
}