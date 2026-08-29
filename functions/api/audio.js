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
    const key = url.searchParams.get("key");

    if (!key) return text("Missing required key parameter.", 400);

    const bucket = getBucket(env);
    if (!bucket) return text("Missing R2 bucket binding.", 500);

    const object = await bucket.get(key);
    if (!object) return text("Audio file not found.", 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", headers.get("Content-Type") || contentTypeFromKey(key));
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(object.body, { headers });
  } catch (error) {
    return text(error?.message || "Unable to load audio file.", 500);
  }
}

function getBucket(env) {
  for (const name of BUCKET_BINDING_NAMES) {
    if (env[name] && typeof env[name].get === "function") return env[name];
  }
  return null;
}

function contentTypeFromKey(key) {
  const ext = String(key).split(".").pop().toLowerCase();
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "wav") return "audio/wav";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "flac") return "audio/flac";
  if (ext === "aac") return "audio/aac";
  return "application/octet-stream";
}

function text(message, status) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}
