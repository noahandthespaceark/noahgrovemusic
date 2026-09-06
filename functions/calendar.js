const DEFAULT_TIMEBRAIN_GIGS_URL = "https://timebrain.pages.dev/api/public/gigs";

function cleanEvent(event = {}) {
  return {
    uid: String(event.uid || event.id || ""),
    title: String(event.title || "Noah Grove Music"),
    location: String(event.location || ""),
    description: String(event.description || ""),
    url: String(event.url || ""),
    start: String(event.start || ""),
    end: String(event.end || event.start || ""),
    allDay: Boolean(event.allDay),
    recurring: Boolean(event.recurring),
    sequence: Number(event.sequence || 0),
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
    const events = (Array.isArray(data?.events) ? data.events : [])
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
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } }
    );
  } catch (error) {
    return Response.json(
      { events: [], source: "timebrain", error: "TimeBrain gigs feed unavailable" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
