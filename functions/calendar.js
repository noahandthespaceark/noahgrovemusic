const DEFAULT_TIMEBRAIN_GIGS_URL = "https://timebrain.pages.dev/api/public/gigs";

function hasExplicitPrivacy(event = {}) {
  const visibility = String(event.visibility || event.access || "").trim().toLowerCase();
  if (typeof event.isPrivate === "boolean") return event.isPrivate;
  if (typeof event.isPublic === "boolean") return !event.isPublic;
  if (typeof event.public === "boolean") return !event.public;
  if (visibility === "private") return true;
  if (visibility === "public") return false;
  return false;
}

function isPrivateEvent(event = {}) {
  const title = String(event.title || "");
  const id = String(event.id || event.uid || "");
  return hasExplicitPrivacy(event)
    || /\bprivate\b/i.test(title)
    || /^(unified_|integration_gig_)/i.test(id);
}

function sanitizePrivateLocation(location = "") {
  const raw = String(location || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";

  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const statePattern = /^(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?:\s+\d{5}(?:-\d{4})?)?$/i;
  const cityState = parts.length > 1 && statePattern.test(parts[parts.length - 1])
    ? parts.slice(-2).join(", ").replace(/\s+\d{5}(?:-\d{4})?$/, "")
    : "";

  const streetPattern = /\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|circle|cir|court|ct|highway|hwy|parkway|pkwy|way)\b/i;
  const withoutAddress = raw
    .replace(/^\d+\s+[^,]+\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|circle|cir|court|ct|highway|hwy|parkway|pkwy|way)\b\s*,?\s*/i, "")
    .replace(/\s+\d+\s+[^,]+\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|circle|cir|court|ct|highway|hwy|parkway|pkwy|way)\b\s*,?/i, " ")
    .replace(/\b\d{5}(?:-\d{4})?\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/^,|,$/g, "")
    .trim();

  if (cityState) {
    const venue = withoutAddress.replace(new RegExp(`\\s*,?\\s*${cityState.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*$`, "i"), "").trim();
    return venue && !/^\d+\s/.test(venue) ? `${venue}, ${cityState}` : cityState;
  }

  if (streetPattern.test(raw) || /^\d+\s/.test(raw)) return "Private event";
  return withoutAddress;
}

function cleanEvent(event = {}) {
  const privateEvent = isPrivateEvent(event);
  return {
    uid: String(event.uid || event.id || ""),
    title: String(event.title || "Noah Grove Music"),
    location: privateEvent ? sanitizePrivateLocation(event.location) : String(event.location || ""),
    start: String(event.start || ""),
    end: String(event.end || event.start || ""),
    allDay: Boolean(event.allDay),
    recurring: Boolean(event.recurring),
    private: privateEvent,
    source: "timebrain",
    category: "Gigs"
  };
}

export async function onRequestGet(context) {
  const gigsUrl = String(context.env?.TIMEBRAIN_GIGS_URL || DEFAULT_TIMEBRAIN_GIGS_URL).trim();

  try {
    const response = await fetch(gigsUrl, {
      headers: {
        "Accept": "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": "NoahGroveMusic-TimeBrain/1.0"
      }
    });

    if (!response.ok) {
      return Response.json(
        { events: [], source: "timebrain", error: "TimeBrain gigs feed unavailable" },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    const data = await response.json();
    if (data?.ok === false || data?.source !== "timebrain" || !Array.isArray(data?.events)) {
      throw new Error("Invalid TimeBrain gigs feed");
    }
    const events = data.events
      .map(cleanEvent)
      .filter((event) => event.start && !Number.isNaN(new Date(event.start).getTime()))
      .filter((event) => new Date(event.end || event.start).getTime() >= Date.now())
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    return Response.json(
      {
        events,
        source: "timebrain",
        category: "Gigs",
        generatedAt: data?.generatedAt || new Date().toISOString()
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { events: [], source: "timebrain", error: "TimeBrain gigs feed unavailable" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
