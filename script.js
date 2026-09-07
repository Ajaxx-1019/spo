/* ==================== Icons (inline SVG strings) ==================== */

const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 4V15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7.5 11L12 15.5L16.5 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 18.5H19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

const ICON_SHUFFLE = `<svg viewBox="0 0 24 24" fill="none"><path d="M4 6H7.5L14 18H20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 18H7.5L9.2 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 6H20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M17.5 3.5L20.5 6L17.5 8.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.5 15.5L20.5 18L17.5 20.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const ICON_PLAYALL = `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6"/><path d="M10 8.5L15.5 12L10 15.5V8.5Z" fill="currentColor"/></svg>`;

const ICON_TRACKS = `<svg viewBox="0 0 24 24" fill="none"><path d="M4 7H20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4 12H20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4 17H14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const ICON_EQ = `<svg class="eq" viewBox="0 0 16 16" fill="none"><rect class="eq-b1" x="2" y="6" width="2.6" height="8" rx="1" fill="currentColor"/><rect class="eq-b2" x="6.7" y="2" width="2.6" height="12" rx="1" fill="currentColor"/><rect class="eq-b3" x="11.4" y="8" width="2.6" height="6" rx="1" fill="currentColor"/></svg>`;

/* ==================== Global state ==================== */

const audio = document.getElementById("audio");

let queue = [];
let queueIndex = -1;
let shuffleOn = false;
let baseOrder = [];
let shuffledOrder = [];
let resultTitle = "";
let resultThumb = "";
let sourceSelected = "spotidown";

/* ==================== Source segmented control ==================== */

function setSource(name, btnEl) {
    sourceSelected = name;
    document.querySelectorAll(".segment-opt").forEach((b) => {
        b.classList.toggle("active", b === btnEl);
        b.setAttribute("aria-selected", b === btnEl ? "true" : "false");
    });
}

/* ==================== Search ==================== */

const linkInput = document.getElementById("link");
const searchBtn = document.getElementById("searchBtn");
const resultZone = document.getElementById("resultZone");
const toolbarZone = document.getElementById("toolbarZone");
const trackZone = document.getElementById("trackZone");

async function searchLink() {

    const url = linkInput.value.trim();

    if (!url) {
        linkInput.focus();
        return;
    }

    searchBtn.classList.add("loading");
    resultZone.innerHTML = `
        <div class="skeleton-hero glass">
            <div class="skeleton-box skeleton-cover"></div>
            <div class="skeleton-lines">
                <div class="skeleton-line w60"></div>
                <div class="skeleton-line w35"></div>
            </div>
        </div>
    `;
    toolbarZone.innerHTML = "";
    trackZone.innerHTML = "";

    try {

        const res = await fetch(
            "/api/spotify-search?url=" + encodeURIComponent(url) +
            "&source=" + encodeURIComponent(sourceSelected)
        );
        const data = await res.json();

        searchBtn.classList.remove("loading");

        if (!data.status) {
            resultZone.innerHTML = `<div class="state-msg">${escapeHtml(data.message || "Gagal mengambil data.")}</div>`;
            return;
        }

        resultTitle = data.title || "Spotify";
        resultThumb = data.thumbnail || "";

        const rawTracks = (data.downloads || []).filter((d) => !isCoverLabel(d.type));

        if (!rawTracks.length) {
            resultZone.innerHTML = `<div class="state-msg">Gak ada lagu yang ketemu di link itu.</div>`;
            return;
        }

        baseOrder = rawTracks.map((d) => ({ label: d.type, token: d.url }));
        shuffledOrder = smartShuffleOrder(baseOrder);
        shuffleOn = false;

        renderResultHero();
        renderToolbar();
        renderTrackList();

    } catch (err) {
        searchBtn.classList.remove("loading");
        resultZone.innerHTML = `<div class="state-msg">${escapeHtml(err.message)}</div>`;
    }
}

function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
}

function isCoverLabel(label) {
    return /\[cover\]/i.test(label || "") || (label || "").toLowerCase() === "cover";
}

function extractArtist(label) {
    let s = (label || "").replace(/^\d+\.\s*/, "").replace(/\s*\[[^\]]*\]\s*$/, "");
    const idx = s.indexOf(" - ");
    return idx !== -1 ? s.slice(0, idx).trim() : s.trim();
}

function cleanFilename(label) {
    return (label || "track")
        .replace(/^\d+\.\s*/, "")
        .replace(/\s*\[[^\]]*\]\s*$/, "")
        .replace(/[\\/:*?"<>|]/g, "");
}

/* ==================== Rendering ==================== */

function renderResultHero() {
    resultZone.innerHTML = `
        <div class="result-hero glass">
            <div class="cover-glow"></div>
            <img class="result-cover" src="${resultThumb}" alt="" onerror="this.style.visibility='hidden'">
            <div class="result-meta">
                <strong>${escapeHtml(resultTitle)}</strong>
                <div class="meta-row">${ICON_TRACKS}<span>${baseOrder.length} lagu</span></div>
            </div>
        </div>
    `;
}

function renderToolbar() {
    toolbarZone.innerHTML = `
        <button class="pill-btn glass ${shuffleOn ? "active" : ""}" id="shuffleBtn" onclick="toggleShuffle()">
            ${ICON_SHUFFLE}<span>Shuffle Pintar</span>
        </button>
        <button class="pill-btn glass" onclick="playAllFromStart()">
            ${ICON_PLAYALL}<span>Putar Semua</span>
        </button>
        <button class="pill-btn glass" id="downloadAllBtn" onclick="downloadAllTracks()">
            ${ICON_DOWNLOAD}<span>Download Semua</span>
        </button>
    `;
}

function renderTrackList() {
    const order = shuffleOn ? shuffledOrder : baseOrder;

    trackZone.innerHTML = order.map((t, i) => `
        <div class="track-row" data-qidx="${i}" data-token="${escapeHtml(t.token)}" style="animation-delay:${Math.min(i * 28, 380)}ms" onclick="playFromOrder(${i})">
            <span class="track-index">
                <span>${i + 1}</span>
                <span class="row-eq">${ICON_EQ}</span>
            </span>
            <span class="track-title">${escapeHtml(cleanFilename(t.label))}</span>
            <button class="track-dl" title="Unduh MP3" onclick="event.stopPropagation(); downloadTrackFromRow(this, ${JSON.stringify(t).replace(/"/g, "&quot;")})">${ICON_DOWNLOAD}</button>
        </div>
    `).join("");

    highlightPlaying();
}

/* ==================== Playback queue / smart shuffle ==================== */

function playFromOrder(i) {
    queue = shuffleOn ? shuffledOrder : baseOrder;
    queueIndex = i;
    loadAndPlay();
    highlightPlaying();
}

function playAllFromStart() {
    if (!baseOrder.length) return;
    playFromOrder(0);
}

function toggleShuffle() {
    shuffleOn = !shuffleOn;

    if (shuffleOn) shuffledOrder = smartShuffleOrder(baseOrder);

    if (queue === baseOrder || queue === shuffledOrder) {
        const currentTrack = queue[queueIndex];
        queue = shuffleOn ? shuffledOrder : baseOrder;
        queueIndex = queue.findIndex((t) => t.token === currentTrack?.token);
        if (queueIndex === -1) queueIndex = 0;
    }

    renderToolbar();
    renderTrackList();
}

/**
 * Smart Shuffle — bounded local shuffle, not a full random teleport.
 * A plain Fisher-Yates would happily send track #30 straight to #1,
 * which feels jarring. This shuffles inside small overlapping windows
 * (like Spotify's Smart Shuffle keeping some continuity) and separately
 * repairs same-artist collisions within a short local radius, so the
 * result feels shuffled but never chaotic.
 */
function smartShuffleOrder(tracks) {
    const arr = [...tracks];
    const n = arr.length;
    if (n < 2) return arr;

    const WINDOW = Math.max(4, Math.min(8, Math.ceil(n / 4)));

    for (let start = 0; start < n; start += WINDOW) {
        const end = Math.min(start + WINDOW, n);
        for (let i = end - 1; i > start; i--) {
            const j = start + Math.floor(Math.random() * (i - start + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    // light cross-window mixing, still bounded to a small radius
    const extraPasses = Math.floor(n / 3);
    for (let k = 0; k < extraPasses; k++) {
        const i = Math.floor(Math.random() * (n - 1));
        const maxJ = Math.min(n - 1, i + WINDOW);
        const j = i + Math.floor(Math.random() * (maxJ - i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    // avoid the same artist landing back to back, swapping only nearby
    for (let i = 1; i < arr.length; i++) {
        const artistI = extractArtist(arr[i].label);
        const artistPrev = extractArtist(arr[i - 1].label);
        if (artistI && artistI === artistPrev) {
            for (let d = 1; d <= WINDOW; d++) {
                const j = i + d;
                if (j >= arr.length) break;
                if (extractArtist(arr[j].label) !== artistPrev) {
                    [arr[i], arr[j]] = [arr[j], arr[i]];
                    break;
                }
            }
        }
    }

    return arr;
}

function highlightPlaying() {
    document.querySelectorAll(".track-row").forEach((el) => {
        el.classList.toggle("playing", Number(el.dataset.qidx) === queueIndex);
    });
}

/* ==================== Download ==================== */

async function downloadTrackFromRow(btnEl, track) {
    btnEl.classList.add("busy");
    try {
        await downloadTrack(track);
    } finally {
        btnEl.classList.remove("busy");
    }
}

async function downloadTrack(track) {
    try {
        const res = await fetch("/api/spotify-resolve?token=" + encodeURIComponent(track.token));
        const data = await res.json();

        if (!data.status || !data.url) {
            alert("Gagal mendapatkan link download.");
            return;
        }

        const a = document.createElement("a");
        a.href = data.url;
        a.download = `${cleanFilename(track.label)}.mp3`;
        document.body.appendChild(a);
        a.click();
        a.remove();

    } catch (err) {
        alert("Gagal download: " + err.message);
    }
}

function downloadCurrent() {
    const track = queue[queueIndex];
    if (!track) return;
    downloadTrack(track);
}

let downloadAllRunning = false;

async function downloadAllTracks() {
    if (downloadAllRunning) return;
    if (!baseOrder.length) return;

    downloadAllRunning = true;
    const btn = document.getElementById("downloadAllBtn");
    const label = btn.querySelector("span");
    const original = label.textContent;

    for (let i = 0; i < baseOrder.length; i++) {
        const t = baseOrder[i];
        label.textContent = `${i + 1}/${baseOrder.length}...`;
        try {
            await downloadTrack(t);
        } catch {
            // lanjut walau satu track gagal
        }
        if (i < baseOrder.length - 1) {
            await new Promise((r) => setTimeout(r, 2500));
        }
    }

    label.textContent = original;
    downloadAllRunning = false;
}

/* ==================== Custom player ==================== */

const playerCover = document.getElementById("playerCover");
const playerTitle = document.getElementById("playerTitle");
const playPauseBtn = document.getElementById("playPauseBtn");
const seek = document.getElementById("seek");
const curTime = document.getElementById("curTime");
const durTime = document.getElementById("durTime");
const iconPlay = playPauseBtn.querySelector(".icon-play");
const iconPause = playPauseBtn.querySelector(".icon-pause");

function loadAndPlay() {
    const track = queue[queueIndex];
    if (!track) return;

    playerCover.style.opacity = "1";
    playerCover.src = resultThumb || "";
    playerTitle.textContent = cleanFilename(track.label);

    audio.src = "/api/spotify-stream?token=" + encodeURIComponent(track.token);
    audio.play().catch(() => {});
}

function togglePlay() {
    if (!audio.src) return;
    if (audio.paused) {
        audio.play();
    } else {
        audio.pause();
    }
}

function playNext() {
    if (!queue.length) return;
    queueIndex = (queueIndex + 1) % queue.length;
    loadAndPlay();
    highlightPlaying();
}

function playPrev() {
    if (!queue.length) return;
    queueIndex = (queueIndex - 1 + queue.length) % queue.length;
    loadAndPlay();
    highlightPlaying();
}

function formatTime(sec) {
    if (!isFinite(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

function setPlayingIcon(isPlaying) {
    iconPlay.style.display = isPlaying ? "none" : "block";
    iconPause.style.display = isPlaying ? "block" : "none";
}

audio.addEventListener("play", () => setPlayingIcon(true));
audio.addEventListener("pause", () => setPlayingIcon(false));

audio.addEventListener("loadedmetadata", () => {
    seek.max = Math.floor(audio.duration) || 0;
    durTime.textContent = formatTime(audio.duration);
});

audio.addEventListener("timeupdate", () => {
    seek.value = Math.floor(audio.currentTime);
    curTime.textContent = formatTime(audio.currentTime);
});

audio.addEventListener("ended", () => {
    if (queue.length > 1) {
        playNext();
    } else {
        setPlayingIcon(false);
    }
});

seek.addEventListener("input", () => {
    audio.currentTime = Number(seek.value);
});
