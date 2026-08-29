const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "wav", "ogg", "flac", "aac"]);
const BUCKET_BINDING_NAMES = [
  "MUSIC_BUCKET",
  "AUDIO_BUCKET",
  "MEDIA_BUCKET",
  "R2_BUCKET",
  "NOAH_MUSIC_BUCKET",
  "NOAH_GROVE_MUSIC_BUCKET"
];

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const prefix = url.searchParams.get("prefix") || "";
    const limit = Math.min(Number(url.searchParams.get("limit") || 1000), 1000);

    const bucket = getBucket(env);
    if (!bucket) {
      return json({
        ok: false,
        error: "Missing R2 bucket binding. Add a Cloudflare Pages R2 binding named MUSIC_BUCKET, AUDIO_BUCKET, MEDIA_BUCKET, R2_BUCKET, NOAH_MUSIC_BUCKET, or NOAH_GROVE_MUSIC_BUCKET."
      }, 500);
    }

    const objects = [];
    let cursor;

    do {
      const listed = await bucket.list({ prefix, cursor, limit });
      objects.push(...listed.objects);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor && objects.length < 5000);

    const tracks = objects
      .filter(object => isAudioKey(object.key))
      .map(object => ({
        title: titleFromKey(object.key),
        key: object.key,
        url: `/api/audio?key=${encodeURIComponent(object.key)}`,
        downloadUrl: `/api/download?key=${encodeURIComponent(object.key)}`,
        size: object.size || null,
        uploaded: object.uploaded ? object.uploaded.toISOString() : null
      }))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));

    return json({ ok: true, source: "r2", count: tracks.length, tracks }, 200, {
      "Cache-Control": "public, max-age=60, s-maxage=300"
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Unable to list audio tracks." }, 500);
  }
}

function getBucket(env) {
  for (const name of BUCKET_BINDING_NAMES) {
    if (env[name] && typeof env[name].list === "function") return env[name];
  }
  return null;
}

function isAudioKey(key) {
  const clean = String(key || "").split("?")[0];
  const ext = clean.includes(".") ? clean.split(".").pop().toLowerCase() : "";
  return AUDIO_EXTENSIONS.has(ext) && !clean.endsWith("/");
}

function titleFromKey(key) {
  const fileName = String(key).split("/").pop() || String(key);
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}
