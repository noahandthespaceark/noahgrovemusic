(function () {
  const endpoint = "/api/track";
  const visitorKey = "ng_visitor_id";
  const sessionKey = "ng_session_id";
  const now = Date.now();
  const visitorId = getOrCreate(visitorKey, 365 * 24 * 60 * 60 * 1000);
  const sessionId = getSession();
  const sentProgress = new Map();

  function getOrCreate(key) {
    let value = localStorage.getItem(key);
    if (!value) { value = cryptoRandom(); localStorage.setItem(key, value); }
    return value;
  }
  function getSession() {
    try {
      const existing = JSON.parse(sessionStorage.getItem(sessionKey) || "null");
      if (existing && existing.id) return existing.id;
    } catch {}
    const value = { id: cryptoRandom(), created: now };
    sessionStorage.setItem(sessionKey, JSON.stringify(value));
    return value.id;
  }
  function cryptoRandom() {
    try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  }
  function track(eventType, data) {
    const payload = JSON.stringify({ eventType, visitorId, sessionId, page: location.pathname, title: document.title, referrer: document.referrer, ...data });
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon(endpoint, blob)) return;
    }
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
  }
  window.NoahStats = { track };

  track("page_view", { meta: { path: location.pathname + location.search } });

  document.addEventListener("click", (event) => {
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link) return;
    const href = link.getAttribute("href") || "";
    const label = (link.textContent || link.getAttribute("aria-label") || href).trim().slice(0, 160);
    if (/paypal|venmo|cash\s*app|square|checkout|tip|support/i.test(label + " " + href)) {
      track("support_click", { objectType: "support", objectId: href, objectTitle: label });
    } else if (/youtube|instagram|facebook|tiktok|spotify|apple|bandcamp/i.test(href)) {
      track("outbound_click", { objectType: "outbound", objectId: href, objectTitle: label });
    }
  }, true);

  window.addEventListener("message", (event) => {
    if (!String(event.origin || "").includes("youtube.com")) return;
  });

  window.onYouTubeIframeAPIReady = function () { setupYouTubeTracking(); };
  function loadYouTubeApi() {
    if (!document.querySelector('iframe[src*="youtube.com/embed"]')) return;
    document.querySelectorAll('iframe[src*="youtube.com/embed"]').forEach((iframe) => {
      try {
        const url = new URL(iframe.src);
        url.searchParams.set("enablejsapi", "1");
        url.searchParams.set("origin", location.origin);
        iframe.src = url.toString();
      } catch {}
    });
    if (window.YT && window.YT.Player) setupYouTubeTracking();
    else {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  }
  function setupYouTubeTracking() {
    if (!window.YT || !window.YT.Player) return;
    document.querySelectorAll('iframe[src*="youtube.com/embed"]').forEach((iframe, index) => {
      if (iframe.dataset.ngYoutubeTracked) return;
      iframe.dataset.ngYoutubeTracked = "1";
      let videoId = "youtube-video";
      try { videoId = new URL(iframe.src).pathname.split("/").pop() || videoId; } catch {}
      let timer;
      const player = new YT.Player(iframe, {
        events: {
          onStateChange: (event) => {
            const title = iframe.title || `YouTube video ${index + 1}`;
            if (event.data === YT.PlayerState.PLAYING) {
              track("youtube_play", { objectType: "youtube", objectId: videoId, objectTitle: title });
              clearInterval(timer);
              timer = setInterval(() => reportYoutubeProgress(player, videoId, title), 10000);
            } else if (event.data === YT.PlayerState.PAUSED) {
              reportYoutubeProgress(player, videoId, title);
              track("youtube_pause", { objectType: "youtube", objectId: videoId, objectTitle: title });
              clearInterval(timer);
            } else if (event.data === YT.PlayerState.ENDED) {
              reportYoutubeProgress(player, videoId, title, true);
              track("youtube_complete", { objectType: "youtube", objectId: videoId, objectTitle: title, percent: 100 });
              clearInterval(timer);
            }
          }
        }
      });
    });
  }
  function reportYoutubeProgress(player, id, title, force) {
    let seconds = 0, duration = 0;
    try { seconds = player.getCurrentTime() || 0; duration = player.getDuration() || 0; } catch { return; }
    const percent = duration ? Math.round((seconds / duration) * 100) : 0;
    const bucket = Math.floor(percent / 25) * 25;
    const key = `yt:${id}:${bucket}`;
    if (!force && (bucket < 25 || sentProgress.get(key))) return;
    sentProgress.set(key, true);
    track("youtube_progress", { objectType: "youtube", objectId: id, objectTitle: title, seconds: Math.round(seconds), percent });
  }
  loadYouTubeApi();
})();
