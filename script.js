/* ==================== Global state ==================== */

const audio = document.getElementById("audio");

let queue = [];          // tracks currently loaded for playback: {label, token}
let queueIndex = -1;
let shuffleOn = false;
let baseOrder = [];       // tracks in original order
let shuffledOrder = [];   // smart-shuffled version
let resultTitle = "";
let resultThumb = "";

/* ==================== Search ==================== */

const linkInput = document.getElementById("link");
const sourceSelect = document.getElementById("source");
const resultHeader = document.getElementById("resultHeader");
const listActions = document.getElementById("listActions");
const trackListEl = document.getElementById("trackList");
const shuffleBtn = document.getElementById("shuffleBtn");

async function searchLink() {

    const url = linkInput.value.trim();
    const source = sourceSelect.value;

    if (!url) {
        alert("Tempel link Spotify dulu.");
        return;
    }

    resultHeader.innerHTML = "<p class='msg'>Mencari...</p>";
    listActions.classList.remove("show");
    trackListEl.innerHTML = "";

    try {

        const res = await fetch(
            "/api/spotify-search?url=" + encodeURIComponent(url) +
            "&source=" + encodeURIComponent(source)
        );
        const data = await res.json();

        if (!data.status) {
            resultHeader.innerHTML = `<p class="msg">${data.message || "Gagal mengambil data."}</p>`;
            return;
        }

        resultTitle = data.title || "Spotify";
        resultThumb = data.thumbnail || "";

        // filter out cover-image entries, keep audio tracks only
        const rawTracks = (data.downloads || []).filter(
            (d) => !isCoverLabel(d.type)
        );

        if (!rawTracks.length) {
            resultHeader.innerHTML = "<p class='msg'>Gak ada lagu yang ketemu.</p>";
            return;
        }

        baseOrder = rawTracks.map((d) => ({ label: d.type, token: d.url }));
        shuffledOrder = smartShuffleOrder(baseOrder);
        shuffleOn = false;
        shuffleBtn.textContent = "🔀 Smart Shuffle: OFF";
        shuffleBtn.classList.remove("on");

        resultHeader.innerHTML = `
        <div class="result-header">
            <img src="${resultThumb}" onerror="this.style.visibility='hidden'">
            <div class="r-meta">
                <strong>${resultTitle}</strong>
                <span>${baseOrder.length} lagu</span>
            </div>
        </div>
        `;

        listActions.classList.add("show");
        renderTrackList();

    } catch (err) {
        resultHeader.innerHTML = `<p class="msg">${err.message}</p>`;
    }
}

function isCoverLabel(label) {
    return /\[cover\]/i.test(label || "") || (label || "").toLowerCase() === "cover";
}

function extractArtist(label) {
    let s = (label || "").replace(/^\d+\.\s*/, "").replace(/\s*\[[^\]]*\]\s*$/, "");
    const idx = s.indexOf(" - ");
    return idx !== -1 ? s.slice(0, idx).trim() : s.trim();
}

/* ==================== Track list rendering ==================== */

function renderTrackList() {
    const order = shuffleOn ? shuffledOrder : baseOrder;

    trackListEl.innerHTML = order.map((t, i) => `
        <div class="track-item" data-qidx="${i}" onclick="playFromOrder(${i})">
            <div class="track-meta">${t.label}</div>
            <button class="track-dl" title="Unduh MP3" onclick="event.stopPropagation(); downloadTrack(${JSON.stringify(t)})">⬇</button>
        </div>
    `).join("");
}

function playFromOrder(i) {
    queue = shuffleOn ? shuffledOrder : baseOrder;
    queueIndex = i;
    loadAndPlay();
    highlightPlaying();
}

function playAllFromStart() {
    if (!baseOrder.length) {
        alert("Cari link dulu.");
        return;
    }
    playFromOrder(0);
}

function toggleShuffle() {
    shuffleOn = !shuffleOn;
    shuffleBtn.textContent = shuffleOn ? "🔀 Smart Shuffle: ON" : "🔀 Smart Shuffle: OFF";
    shuffleBtn.classList.toggle("on", shuffleOn);

    if (shuffleOn) shuffledOrder = smartShuffleOrder(baseOrder);

    if (queue === baseOrder || queue === shuffledOrder) {
        const currentTrack = queue[queueIndex];
        queue = shuffleOn ? shuffledOrder : baseOrder;
        queueIndex = queue.findIndex((t) => t.token === currentTrack?.token);
        if (queueIndex === -1) queueIndex = 0;
    }

    renderTrackList();
    highlightPlaying();
}

/**
 * "Smart" shuffle: plain random shuffle would happily put the same
 * artist back to back. This does a Fisher-Yates shuffle then repairs
 * the order so consecutive tracks don't share an artist when avoidable.
 * Artist is heuristically extracted from the "NN. Artist - Title [MP3]"
 * label since that's all the scraper gives us for playlist items.
 */
function smartShuffleOrder(tracks) {
    const arr = [...tracks];

    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    for (let i = 1; i < arr.length; i++) {
        const artistI = extractArtist(arr[i].label);
        const artistPrev = extractArtist(arr[i - 1].label);
        if (artistI && artistI === artistPrev) {
            let swapWith = -1;
            for (let j = i + 1; j < arr.length; j++) {
                const artistJ = extractArtist(arr[j].label);
                const okWithPrev = artistJ !== artistPrev;
                const nextArtist = i + 1 < arr.length ? extractArtist(arr[i + 1].label) : null;
                const okWithNext = !nextArtist || artistJ !== nextArtist;
                if (okWithPrev && okWithNext) {
                    swapWith = j;
                    break;
                }
            }
            if (swapWith !== -1) {
                [arr[i], arr[swapWith]] = [arr[swapWith], arr[i]];
            }
        }
    }

    return arr;
}

function highlightPlaying() {
    document.querySelectorAll(".track-item").forEach((el) => {
        el.classList.toggle("playing", Number(el.dataset.qidx) === queueIndex);
    });
}

/* ==================== Download ==================== */

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

function cleanFilename(label) {
    return (label || "track")
        .replace(/^\d+\.\s*/, "")
        .replace(/\s*\[[^\]]*\]\s*$/, "")
        .replace(/[\\/:*?"<>|]/g, "");
}

/**
 * Download semua lagu berurutan dengan jeda antar request biar gak
 * kena rate limit di sisi SpotiDown/SoundLoaders. Sengaja jalan di
 * browser (bukan satu serverless function panjang) karena Vercel
 * punya batas waktu eksekusi per request.
 */
let downloadAllRunning = false;

async function downloadAllTracks() {
    if (downloadAllRunning) return;
    if (!baseOrder.length) {
        alert("Cari link dulu.");
        return;
    }

    downloadAllRunning = true;
    const btn = document.getElementById("downloadAllBtn");
    const original = btn.textContent;

    for (let i = 0; i < baseOrder.length; i++) {
        const t = baseOrder[i];
        btn.textContent = `⬇ Mengunduh ${i + 1}/${baseOrder.length}...`;
        try {
            await downloadTrack(t);
        } catch {
            // lanjut walau satu track gagal
        }
        if (i < baseOrder.length - 1) {
            await new Promise((r) => setTimeout(r, 2500)); // jeda anti rate-limit
        }
    }

    btn.textContent = original;
    downloadAllRunning = false;
}

/* ==================== Custom player ==================== */

const playerCover = document.getElementById("playerCover");
const playerTitle = document.getElementById("playerTitle");
const playPauseBtn = document.getElementById("playPauseBtn");
const seek = document.getElementById("seek");
const curTime = document.getElementById("curTime");
const durTime = document.getElementById("durTime");

function loadAndPlay() {
    const track = queue[queueIndex];
    if (!track) return;

    playerCover.src = resultThumb || "";
    playerTitle.textContent = cleanFilename(track.label);
    playPauseBtn.textContent = "⏳";

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

audio.addEventListener("play", () => { playPauseBtn.textContent = "⏸"; });
audio.addEventListener("pause", () => { playPauseBtn.textContent = "▶"; });

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
        playPauseBtn.textContent = "▶";
    }
});

seek.addEventListener("input", () => {
    audio.currentTime = Number(seek.value);
});
