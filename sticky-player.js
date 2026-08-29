/* Ravenel Bridge sticky player. Tracks now load from a Cloudflare Pages Function backed by an R2 bucket binding. */
document.addEventListener("DOMContentLoaded", async function () {
  const TRACK_FEED_URL = "/api/tracks";
  const LEGACY_MANIFEST_URL = "player-tracks.json";
  const LEGACY_BASE_URL = "https://media.noahgrove.com";
  const DEFAULT_TRACKS = [
  {
    "title": "2 Good 2 Be True",
    "file": "2 Good 2 Be True.mp3"
  },
  {
    "title": "A Promise in the Wind",
    "file": "A Promise in the Wind.mp3"
  },
  {
    "title": "Annihilisticated",
    "file": "Annihilisticated.mp3"
  },
  {
    "title": "Back in That Time",
    "file": "Back in That Time.mp3"
  },
  {
    "title": "Back in the Trenches",
    "file": "Back in the Trenches.mp3"
  },
  {
    "title": "Be More",
    "file": "Be More.mp3"
  },
  {
    "title": "Beginning to Believe",
    "file": "Beginning to Believe.mp3"
  },
  {
    "title": "California",
    "file": "California.mp3"
  },
  {
    "title": "Can't Forget",
    "file": "Can't Forget.mp3"
  },
  {
    "title": "Can't Quit You",
    "file": "Can't Quit You.mp3"
  },
  {
    "title": "Cancün",
    "file": "Cancün.mp3",
    "aliases": [
      "Cancun.mp3",
      "Cancún.mp3"
    ]
  },
  {
    "title": "Crazy Heart",
    "file": "Crazy Heart.mp3"
  },
  {
    "title": "Don't Be Fooled By the Sun",
    "file": "Don't Be Fooled By the Sun.mp3"
  },
  {
    "title": "Don't Let Me Fall",
    "file": "Don't Let Me Fall.mp3"
  },
  {
    "title": "Don't Wanna Know",
    "file": "Don't Wanna Know.mp3"
  },
  {
    "title": "Dreamin' in the Day",
    "file": "Dreamin' in the Day.mp3"
  },
  {
    "title": "End of an Era",
    "file": "End of an Era.mp3"
  },
  {
    "title": "Give Me a Sign",
    "file": "Give Me a Sign.mp3"
  },
  {
    "title": "Gonna Turn Out Alright",
    "file": "Gonna Turn Out Alright.mp3"
  },
  {
    "title": "Good Times Ahead",
    "file": "Good Times Ahead.mp3"
  },
  {
    "title": "I Miss You",
    "file": "I Miss You.mp3"
  },
  {
    "title": "I'm a Gamer",
    "file": "I'm a Gamer.mp3"
  },
  {
    "title": "In Jamaica (Noah Grove by AI)",
    "file": "In Jamaica (Noah Grove by AI).mp3"
  },
  {
    "title": "Is It You?",
    "file": "Is It You?.mp3"
  },
  {
    "title": "La La La La Ay Chi Wa Wa",
    "file": "La La La La Ay Chi Wa Wa.mp3"
  },
  {
    "title": "Lady",
    "file": "Lady.mp3"
  },
  {
    "title": "Let Your Broken Heart Go",
    "file": "Let Your Broken Heart Go.mp3"
  },
  {
    "title": "Lost at See",
    "file": "Lost at See.mp3"
  },
  {
    "title": "Madness",
    "file": "Madness.mp3"
  },
  {
    "title": "Mind Set Free",
    "file": "Mind Set Free.mp3"
  },
  {
    "title": "Never Young",
    "file": "Never Young.mp3"
  },
  {
    "title": "Nothing Ever Seems to Change",
    "file": "Nothing Ever Seems to Change.mp3"
  },
  {
    "title": "Speak My Heart",
    "file": "Speak My Heart.mp3"
  },
  {
    "title": "Talking to the People",
    "file": "Talking to the People.mp3"
  },
  {
    "title": "When I Touch Your Hand",
    "file": "When I Touch Your Hand.mp3"
  },
  {
    "title": "You're The Only One",
    "file": "You're The Only One.mp3"
  }
];

  let tracks = await loadTracks();
  let currentTrack = 0;
  let userRequestedPlayback = false;
  const reportedProgress = new Set();

  function trackPlayerEvent(eventType, track, extra = {}) {
    if (!window.NoahStats || !track) return;
    window.NoahStats.track(eventType, {
      objectType: "song",
      objectId: track.key || track.file || track.url || track.title,
      objectTitle: track.title || "Unknown song",
      ...extra
    });
  }

  const audio = document.getElementById("audio");
  const player = document.getElementById("player");
  const playBtn = document.getElementById("play");
  const prevBtn = document.getElementById("prev");
  const nextBtn = document.getElementById("next");
  const progress = document.getElementById("progress");
  const titleEl = document.getElementById("player-title");
  const artistEl = document.getElementById("player-artist");
  const downloadBtn = document.getElementById("download");
  const currentTimeEl = document.getElementById("current-time");
  const durationEl = document.getElementById("duration");
  const togglePlaylistBtn = document.getElementById("toggle-playlist");
  const playerPlaylistEl = document.getElementById("player-playlist");
  const minimizePlayerBtn = document.getElementById("minimize-player");
  const restorePlayerBtn = document.getElementById("restore-player");
  const musicPlayerNudge = document.getElementById("music-player-nudge");
  const dismissMusicPlayerNudgeBtn = document.getElementById("dismiss-music-player-nudge");

  function hideMusicPlayerNudge() {
    if (!musicPlayerNudge) return;
    musicPlayerNudge.classList.add("hidden");
    window.setTimeout(() => {
      if (musicPlayerNudge.classList.contains("hidden")) musicPlayerNudge.hidden = true;
    }, 190);
  }

  if (dismissMusicPlayerNudgeBtn) {
    dismissMusicPlayerNudgeBtn.addEventListener("click", hideMusicPlayerNudge);
  }

  if (minimizePlayerBtn && restorePlayerBtn && player) {
    minimizePlayerBtn.addEventListener("click", () => {
      player.classList.add("player-minimized");
      restorePlayerBtn.classList.add("visible");
      restorePlayerBtn.focus({ preventScroll: true });
    });

    restorePlayerBtn.addEventListener("click", () => {
      player.classList.remove("player-minimized");
      restorePlayerBtn.classList.remove("visible");
      restorePlayerBtn.classList.remove("player-restore-pulse");
      hideMusicPlayerNudge();
      minimizePlayerBtn.focus({ preventScroll: true });
    });
  }

  function syncPlayButton() {
    if (!playBtn || !audio) return;
    const isPlaying = (!audio.paused && !audio.ended) || playBtn.getAttribute("data-playing") === "true";
    playBtn.textContent = isPlaying ? "⏸" : "▶";
    playBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
    if (!isPlaying) playBtn.removeAttribute("data-playing");
  }

  async function loadTracks() {
    try {
      const response = await fetch(`${TRACK_FEED_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("R2 track feed unavailable");
      const data = await response.json();
      const clean = normalizeTrackList(data.tracks || data);
      if (clean.length) return clean;
      throw new Error("R2 track feed returned no playable audio files");
    } catch (error) {
      console.info("R2 track feed unavailable. Falling back to legacy manifest.", error);
      return loadLegacyManifest();
    }
  }

  async function loadLegacyManifest() {
    try {
      const response = await fetch(`${LEGACY_MANIFEST_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Legacy track manifest not found");
      const manifest = await response.json();
      const clean = normalizeTrackList(Array.isArray(manifest) ? manifest : manifest.tracks);
      if (clean.length) return clean;
      throw new Error("Legacy track manifest was empty");
    } catch (error) {
      console.info("Using built-in sticky player fallback tracks.", error);
      return normalizeTrackList(DEFAULT_TRACKS);
    }
  }

  function normalizeTrackList(list) {
    return (Array.isArray(list) ? list : [])
      .filter(track => track && (track.url || track.key || track.file))
      .map(track => {
        const source = track.url || track.key || track.file;
        const key = track.key || track.file || source;
        const url = track.url || ((track.key || track.file) ? `/api/audio?key=${encodeURIComponent(key)}` : `${LEGACY_BASE_URL}/${encodeKeyPath(key)}`);
        return {
          title: track.title || fileToTitle(source),
          url,
          downloadUrl: track.downloadUrl || ((track.key || track.file) ? `/api/download?key=${encodeURIComponent(key)}&name=${encodeURIComponent(track.title || fileToTitle(key))}` : url),
          key,
          aliases: Array.isArray(track.aliases) ? track.aliases : [],
          sourceCandidates: buildSourceCandidates(track, url),
          size: track.size || null,
          uploaded: track.uploaded || null
        };
      });
  }

  function fileToTitle(file) {
    return decodeURIComponent(String(file).split("/").pop())
      .replace(/\.[^.]+$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function encodeKeyPath(key) {
    return String(key).split("/").map(encodeURIComponent).join("/");
  }

  function renderPlayerPlaylist() {
    if (!playerPlaylistEl) return;
    playerPlaylistEl.innerHTML = tracks.length ? tracks.map((track, index) => `
      <div class="player-playlist-row">
        <button type="button" class="player-playlist-name ${index === currentTrack ? "active" : ""}" title="${escapeHtml(track.title)}" onclick="playSong(${index})">
          ${escapeHtml(track.title)}
        </button>
      </div>
    `).join("") : `<div class="player-empty">No songs found in the R2 bucket yet.</div>`;
  }

  function loadTrack(index, options = {}) {
    if (!tracks.length) {
      titleEl.textContent = "Original Music";
      titleEl.title = "Original Music";
      artistEl.textContent = "No songs found";
      return;
    }
    currentTrack = (index + tracks.length) % tracks.length;
    const track = tracks[currentTrack];
    track._sourceIndex = 0;

    // Keep the selected song visible immediately, but do not force the browser
    // to fetch/validate the MP3 before the visitor actually presses play.
    // Some browsers report a harmless metadata preload failure for the R2 stream,
    // which previously created a confusing "Could not play" message on page load.
    if (options.prepareAudio) audio.src = track.sourceCandidates?.[0] || track.url;
    else audio.removeAttribute("src");

    titleEl.textContent = track.title;
    titleEl.title = track.title;
    artistEl.textContent = "Selected song • Noah Grove";
    progress.value = 0;
    currentTimeEl.textContent = "0:00";
    durationEl.textContent = "0:00";
    player.classList.remove("hidden");
    renderPlayerPlaylist();
  }

  async function playTrack() {
    if (!tracks.length) return;
    userRequestedPlayback = true;
    const track = tracks[currentTrack];
    if (!audio.src) audio.src = track.sourceCandidates?.[track._sourceIndex || 0] || track.url;
    try {
      playBtn.textContent = "⏸";
      playBtn.setAttribute("aria-label", "Pause");
      playBtn.setAttribute("data-playing", "true");
      const playPromise = audio.play();
      syncPlayButton();
      await playPromise;
      playBtn.textContent = "⏸";
      playBtn.setAttribute("aria-label", "Pause");
      playBtn.setAttribute("data-playing", "true");
      artistEl.textContent = "Playing • Noah Grove";
      trackPlayerEvent("song_play", track, { seconds: Math.round(audio.currentTime || 0) });
    } catch (error) {
      console.error(error);
      playBtn.removeAttribute("data-playing");
      syncPlayButton();
      artistEl.textContent = "Tap play to start • Noah Grove";
    }
  }

  function pauseTrack() {
    const track = tracks[currentTrack];
    trackPlayerEvent("song_pause", track, {
      seconds: Math.round(audio.currentTime || 0),
      percent: audio.duration ? Math.round((audio.currentTime / audio.duration) * 100) : 0
    });
    playBtn.removeAttribute("data-playing");
    audio.pause();
    syncPlayButton();
    artistEl.textContent = "Paused • Noah Grove";
  }

  async function playSong(index) { loadTrack(index, { prepareAudio: true }); await playTrack(); }

  function downloadSong(index) {
    if (!tracks.length) return;
    const track = tracks[index];
    const filename = filenameFromTrack(track);
    const downloadUrl = buildDownloadUrl(track, filename);

    trackPlayerEvent("song_download", track, { meta: { filename } });

    // Use a normal browser download from our same-origin endpoint.
    // The endpoint streams the full R2/public media object and sets Content-Disposition: attachment.
    triggerBrowserDownload(downloadUrl, filename);
  }

  function buildDownloadUrl(track, filename) {
    const params = new URLSearchParams();
    if (track.key || track.file) params.set("key", track.key || track.file);
    if (track.url && track.url.startsWith("https://media.noahgrove.com/")) params.set("url", track.url);
    params.set("name", filename);
    return `/api/download?${params.toString()}`;
  }

  function triggerBrowserDownload(url, filename) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  playBtn.addEventListener("click", async () => {
    if (!tracks.length) return;
    if (audio.paused) await playTrack(); else pauseTrack();
  });

  prevBtn.addEventListener("click", async () => { loadTrack(currentTrack - 1); await playTrack(); });
  nextBtn.addEventListener("click", async () => { loadTrack(currentTrack + 1); await playTrack(); });

  togglePlaylistBtn.addEventListener("click", () => {
    const isHidden = playerPlaylistEl.classList.toggle("hidden");
    togglePlaylistBtn.textContent = isHidden ? "Songs" : "Hide";
  });

  downloadBtn.addEventListener("click", () => downloadSong(currentTrack));

  audio.addEventListener("play", () => { playBtn.setAttribute("data-playing", "true"); syncPlayButton(); });
  audio.addEventListener("playing", () => {
    playBtn.setAttribute("data-playing", "true");
    syncPlayButton();
    artistEl.textContent = "Playing • Noah Grove";
  });
  audio.addEventListener("pause", () => { playBtn.removeAttribute("data-playing"); syncPlayButton(); });
  audio.addEventListener("ended", () => { playBtn.removeAttribute("data-playing"); syncPlayButton(); });

  audio.addEventListener("timeupdate", () => {
    const percent = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    progress.value = percent || 0;
    currentTimeEl.textContent = formatTime(audio.currentTime);
    durationEl.textContent = formatTime(audio.duration);

    const bucket = Math.floor(percent / 25) * 25;
    const track = tracks[currentTrack];
    const progressKey = `${track?.key || track?.title || currentTrack}:${bucket}`;
    if (bucket >= 25 && !reportedProgress.has(progressKey)) {
      reportedProgress.add(progressKey);
      trackPlayerEvent("song_progress", track, { seconds: Math.round(audio.currentTime || 0), percent: Math.round(percent) });
    }
  });

  progress.addEventListener("input", () => {
    if (!audio.duration) return;
    audio.currentTime = (progress.value / 100) * audio.duration;
  });

  audio.addEventListener("error", async () => {
    const track = tracks[currentTrack];

    // Do not show a user-facing playback error for passive browser preload/metadata checks.
    if (!userRequestedPlayback) {
      console.info("Ignoring passive audio preload/metadata error for selected track.", track?.key || track?.title);
      return;
    }

    if (track?.sourceCandidates && track._sourceIndex < track.sourceCandidates.length - 1) {
      track._sourceIndex += 1;
      audio.src = track.sourceCandidates[track._sourceIndex];
      try { await audio.play(); return; } catch (error) { console.info("Alternate audio source failed.", error); }
    }
    artistEl.textContent = "Could not play this song • Try another track";
    syncPlayButton();
  });

  audio.addEventListener("ended", async () => {
    trackPlayerEvent("song_complete", tracks[currentTrack], { seconds: Math.round(audio.duration || audio.currentTime || 0), percent: 100 });
    loadTrack(currentTrack + 1, { prepareAudio: true });
    await playTrack();
  });


  function buildSourceCandidates(track, primaryUrl) {
    const candidates = [primaryUrl];
    const legacyKeys = [track.key, track.file, ...(Array.isArray(track.aliases) ? track.aliases : [])].filter(Boolean);
    legacyKeys.forEach(key => {
      const legacyUrl = `${LEGACY_BASE_URL}/${encodeKeyPath(key)}`;
      if (!candidates.includes(legacyUrl)) candidates.push(legacyUrl);
    });
    return candidates;
  }

  function filenameFromTrack(track) {
    const keyName = String(track.key || track.file || "").split("/").pop();
    if (keyName && /\.[a-z0-9]+$/i.test(keyName)) return keyName;
    return `${track.title || "Noah Grove Song"}.mp3`;
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "0:00";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remainingSeconds}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  window.playSong = playSong;
  window.downloadSong = downloadSong;
  renderPlayerPlaylist();
  if (tracks.length) loadTrack(0, { prepareAudio: false });
});
