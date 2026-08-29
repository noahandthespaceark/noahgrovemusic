const DEFAULT_ICS_URL = "https://calendar.google.com/calendar/ical/noahdamus%40gmail.com/private-0ddcfdb3022e84a2a7ff0fb4fb19f60a/basic.ics";
const SITE_TIME_ZONE = "America/New_York";
const LOOKAHEAD_DAYS = 365;
const MAX_EVENTS = 40;

function unfoldIcsLines(text) {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function splitProperty(line = "") {
  const idx = line.indexOf(":");
  const head = idx >= 0 ? line.slice(0, idx) : line;
  const value = idx >= 0 ? line.slice(idx + 1) : "";
  const [name, ...paramParts] = head.split(";");
  const params = {};
  for (const part of paramParts) {
    const [key, ...rest] = part.split("=");
    if (key) params[key.toUpperCase()] = rest.join("=").replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value };
}

function cleanText(value = "") {
  return value
    .replace(/\\n/g, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getTimeZoneOffset(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "00" : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - date.getTime();
}

function zonedDateToUtc(year, month, day, hour, minute, second, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffset(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offset);
}

function parseIcsDate(prop) {
  const value = prop.value || "";
  const allDay = prop.params.VALUE === "DATE" || /^\d{8}$/.test(value);

  if (allDay) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    return { date: zonedDateToUtc(year, month, day, 0, 0, 0, SITE_TIME_ZONE), allDay };
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return { date: null, allDay: false };

  const [, y, mo, d, h, mi, s, zulu] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);

  if (zulu) return { date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)), allDay: false };
  return { date: zonedDateToUtc(year, month, day, hour, minute, second, prop.params.TZID || SITE_TIME_ZONE), allDay: false };
}

function parseRRule(value = "") {
  return value.split(";").reduce((rule, part) => {
    const [key, val] = part.split("=");
    if (key) rule[key.toUpperCase()] = val || "";
    return rule;
  }, {});
}

function parseByDay(byDay = "") {
  return byDay.split(",").map((d) => d.replace(/^[+-]?\d+/, "")).filter(Boolean);
}

const DAY_TO_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function sameInstantDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function parseIcs(text) {
  const lines = unfoldIcsLines(text);
  const rawEvents = [];
  let current = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = { exdates: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current?.start) rawEvents.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const prop = splitProperty(line);
    if (prop.name === "UID") current.uid = cleanText(prop.value);
    if (prop.name === "SUMMARY") current.title = cleanText(prop.value);
    if (prop.name === "LOCATION") current.location = cleanText(prop.value);
    if (prop.name === "DESCRIPTION") current.description = cleanText(prop.value);
    if (prop.name === "URL") current.url = cleanText(prop.value);
    if (prop.name === "RRULE") current.rrule = parseRRule(prop.value);
    if (prop.name === "EXDATE") {
      prop.value.split(",").forEach((value) => {
        const parsed = parseIcsDate({ ...prop, value });
        if (parsed.date && !Number.isNaN(parsed.date.valueOf())) current.exdates.push(parsed.date.toISOString());
      });
    }
    if (prop.name === "DTSTART") {
      const parsed = parseIcsDate(prop);
      if (parsed.date && !Number.isNaN(parsed.date.valueOf())) {
        current.start = parsed.date.toISOString();
        current.allDay = parsed.allDay;
      }
    }
    if (prop.name === "DTEND") {
      const parsed = parseIcsDate(prop);
      if (parsed.date && !Number.isNaN(parsed.date.valueOf())) current.end = parsed.date.toISOString();
    }
  }

  const now = new Date(Date.now() - 1000 * 60 * 60 * 10);
  const until = addDays(new Date(), LOOKAHEAD_DAYS);
  const expanded = [];

  for (const event of rawEvents) {
    const start = new Date(event.start);
    const end = event.end ? new Date(event.end) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const duration = end.getTime() - start.getTime();
    const exdateKeys = new Set((event.exdates || []).map((date) => sameInstantDayKey(new Date(date))));

    const pushOccurrence = (occStart, index = 0) => {
      const occEnd = new Date(occStart.getTime() + duration);
      if (occEnd < now || occStart > until) return;
      if (exdateKeys.has(sameInstantDayKey(occStart))) return;
      expanded.push({
        uid: event.uid ? `${event.uid}-${occStart.toISOString()}` : `${event.title || "event"}-${occStart.toISOString()}`,
        title: event.title || "Noah Grove Music",
        location: event.location || "",
        description: event.description || "",
        url: event.url || "",
        start: occStart.toISOString(),
        end: occEnd.toISOString(),
        allDay: Boolean(event.allDay),
        recurring: Boolean(event.rrule),
        sequence: index
      });
    };

    if (!event.rrule?.FREQ) {
      pushOccurrence(start);
      continue;
    }

    const interval = Math.max(1, Number(event.rrule.INTERVAL || 1));
    const countLimit = event.rrule.COUNT ? Number(event.rrule.COUNT) : 1000;
    const ruleUntil = event.rrule.UNTIL ? parseIcsDate({ value: event.rrule.UNTIL, params: {} }).date : until;
    const hardUntil = new Date(Math.min(until.getTime(), ruleUntil?.getTime?.() || until.getTime()));
    let generated = 0;

    if (event.rrule.FREQ === "WEEKLY") {
      const byDays = parseByDay(event.rrule.BYDAY);
      const targetDays = byDays.length ? byDays.map((day) => DAY_TO_INDEX[day]).filter((day) => day !== undefined) : [start.getUTCDay()];
      let cursor = addDays(start, -7);
      while (cursor <= hardUntil && generated < countLimit) {
        for (let i = 0; i < 7; i++) {
          const candidate = addDays(cursor, i);
          if (candidate < start) continue;
          if (targetDays.includes(candidate.getUTCDay())) {
            const occurrence = new Date(candidate);
            occurrence.setUTCHours(start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), 0);
            pushOccurrence(occurrence, generated);
            generated += 1;
            if (generated >= countLimit) break;
          }
        }
        cursor = addDays(cursor, 7 * interval);
      }
    } else if (event.rrule.FREQ === "DAILY") {
      let occurrence = new Date(start);
      while (occurrence <= hardUntil && generated < countLimit) {
        pushOccurrence(new Date(occurrence), generated);
        generated += 1;
        occurrence = addDays(occurrence, interval);
      }
    } else if (event.rrule.FREQ === "MONTHLY") {
      let occurrence = new Date(start);
      while (occurrence <= hardUntil && generated < countLimit) {
        pushOccurrence(new Date(occurrence), generated);
        generated += 1;
        occurrence = addMonths(occurrence, interval);
      }
    } else {
      pushOccurrence(start);
    }
  }

  return expanded
    .filter((event) => new Date(event.end || event.start).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, MAX_EVENTS);
}

export async function onRequestGet(context) {
  const icsUrl = context.env?.CALENDAR_ICS_URL || DEFAULT_ICS_URL;

  try {
    const response = await fetch(icsUrl, {
      headers: { "User-Agent": "NoahGroveMusicCalendar/2.0" }
    });

    if (!response.ok) {
      return Response.json({ events: [], error: "Calendar feed unavailable" }, { status: 502 });
    }

    const ics = await response.text();
    return Response.json(
      { events: parseIcs(ics), generatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=600, s-maxage=600" } }
    );
  } catch (error) {
    return Response.json({ events: [], error: "Calendar feed unavailable" }, { status: 500 });
  }
}
