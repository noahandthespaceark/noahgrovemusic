const BUCKET_BINDING_NAMES = [
  "MUSIC_BUCKET",
  "AUDIO_BUCKET",
  "MEDIA_BUCKET",
  "R2_BUCKET",
  "NOAH_MUSIC_BUCKET",
  "NOAH_GROVE_MUSIC_BUCKET"
];

const PUBLIC_MEDIA_BASE_URLS = [
  "https://media.noahgrove.com"
];

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    const name = url.searchParams.get("name");
    const sourceUrl = url.searchParams.get("url");

    if (!key && !sourceUrl) return text("Missing required key or url parameter.", 400);

    const filename = safeFilename(name || filenameFromKey(key || sourceUrl));

    // First try the bound R2 bucket. This is the best path when Pages has the correct R2 binding.
    const bucket = getBucket(env);
    if (bucket && key) {
      const object = await bucket.get(key);
      if (object && object.body) {
        const headers = attachmentHeaders(filename, key, object);
        if (typeof object.size === "number" && object.size > 0) {
          headers.set("Content-Length", String(object.size));
        }
        return new Response(object.body, { status: 200, headers });
      }
    }

    // If the binding/key lookup misses, proxy the same public media object the player can already stream.
    // This solves cases where playback works through media.noahgrove.com but bucket.get(key) does not.
    const candidates = buildPublicCandidates(key, sourceUrl);
    for (const candidate of candidates) {
      const upstream = await fetch(candidate, {
        headers: { "Accept": "audio/*,application/octet-stream;q=0.9,*/*;q=0.8" },
        cf: { cacheTtl: 3600, cacheEverything: false }
      });

      if (!upstream.ok || !upstream.body) continue;

      const contentType = upstream.headers.get("Content-Type") || contentTypeFromKey(key || candidate);
      const contentLength = Number(upstream.headers.get("Content-Length") || 0);
      const looksLikeAudio = contentType.startsWith("audio/") || contentType === "application/octet-stream";
      const looksLargeEnough = !contentLength || contentLength > 1024;

      if (!looksLikeAudio || !looksLargeEnough) continue;

      const headers = attachmentHeaders(filename, key || candidate);
      headers.set("Content-Type", contentType || contentTypeFromKey(key || candidate));
      const upstreamLength = upstream.headers.get("Content-Length");
      if (upstreamLength) headers.set("Content-Length", upstreamLength);
      return new Response(upstream.body, { status: 200, headers });
    }

    return text("Audio file not found for download.", 404);
  } catch (error) {
    return text(error?.message || "Unable to download file.", 500);
  }
}

function getBucket(env) {
  for (const name of BUCKET_BINDING_NAMES) {
    if (env[name] && typeof env[name].get === "function") return env[name];
  }
  return null;
}

function buildPublicCandidates(key, sourceUrl) {
  const candidates = [];
  if (sourceUrl && isAllowedMediaUrl(sourceUrl)) candidates.push(sourceUrl);
  if (key) {
    for (const base of PUBLIC_MEDIA_BASE_URLS) {
      candidates.push(`${base.replace(/\/$/, "")}/${encodeKeyPath(key)}`);
    }
  }
  return [...new Set(candidates)];
}

function isAllowedMediaUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "media.noahgrove.com";
  } catch {
    return false;
  }
}

function encodeKeyPath(key) {
  return String(key).split("/").map(encodeURIComponent).join("/");
}

function filenameFromKey(key) {
  const clean = String(key || "Noah Grove Song.mp3").split("?")[0];
  return clean.split("/").pop() || "Noah Grove Song.mp3";
}

function safeFilename(filename) {
  const clean = String(filename || "Noah Grove Song.mp3").split("/").pop().trim() || "Noah Grove Song.mp3";
  return /\.[a-z0-9]{2,5}$/i.test(clean) ? clean : `${clean}.mp3`;
}

function contentTypeFromKey(key) {
  const ext = String(key).split("?")[0].split(".").pop().toLowerCase();
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "wav") return "audio/wav";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "flac") return "audio/flac";
  if (ext === "aac") return "audio/aac";
  return "application/octet-stream";
}

function attachmentHeaders(filename, key, object) {
  const headers = new Headers();
  if (object && typeof object.writeHttpMetadata === "function") object.writeHttpMetadata(headers);
  headers.set("Content-Type", headers.get("Content-Type") || contentTypeFromKey(key || filename));
  headers.set("Content-Disposition", contentDispositionAttachment(filename));
  headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function contentDispositionAttachment(filename) {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987ValueChars(filename)}`;
}

function encodeRFC5987ValueChars(value) {
  return encodeURIComponent(value).replace(/['()]/g, escape).replace(/\*/g, "%2A");
}

function text(message, status) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
  });
}
