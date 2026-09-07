import axios from "axios";
import { load } from "cheerio";

/* ===================== self-contained helpers (no local imports) ===================== */

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function getCookiesFromHeaders(headers) {
  if (!headers) return "";
  const raw = headers["set-cookie"] || headers["Set-Cookie"] || [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

function serializeData(obj) {
  return Object.entries(obj || {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? "")}`)
    .join("&");
}

function cleanUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Lets the search box also accept a plain keyword instead of forcing a
 * real Spotify link. SpotiDown/SoundLoaders only understand actual
 * Spotify URLs, so for a text query we first resolve it to a real
 * track link via nexadev's title search, then hand that off to the
 * normal scraping flow below.
 */
async function resolveKeywordToSpotifyUrl(query) {
  try {
    const r = await axios.get(
      `https://api.nexadev.my.id/api/spotifyplay?q=${encodeURIComponent(query)}`,
      { timeout: 10000, validateStatus: () => true },
    );
    const json = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    if (json?.status && json?.result?.url) return json.result.url;
  } catch {
    // fall through to null
  }
  return null;
}

async function scraperFetch(opts, label = "Request") {
  const { url, method = "GET", data, headers = {}, rawResponse = false } = opts;
  let response;
  try {
    response = await axios({
      url,
      method,
      data,
      headers,
      validateStatus: () => true,
      maxRedirects: 5,
      transformResponse: [(d) => d],
    });
  } catch (err) {
    throw new Error(`${label}: network error - ${err.message}`);
  }
  const finalUrl = response.request?.res?.responseUrl || response.config?.url || url;
  if (rawResponse) {
    return { status: response.status, headers: response.headers, data: response.data, url: finalUrl };
  }
  if (response.status < 200 || response.status >= 300) {
    const err = new Error(`${label} failed with status ${response.status}`);
    err.status = response.status;
    err.body = response.data;
    throw err;
  }
  try {
    return JSON.parse(response.data);
  } catch {
    return response.data;
  }
}

function createScraperResult(success, dataOrMessage, status) {
  if (success) return { status: true, ...dataOrMessage };
  return {
    status: false,
    message: typeof dataOrMessage === "string" ? dataOrMessage : "Terjadi kesalahan.",
    httpStatus: status ?? null,
  };
}

/* ===================== scraper ===================== */

let _spSource = null;
let _slSessionCache = null;
let _spSessionCache = null;

function setSpotifySource(source) {
  _spSource = source;
}

async function scrapeSpotify(url, { debug = false } = {}) {
  if (!_spSource) return { status: true, requireSource: true };

  if (url.match(/spotify\.com\/s\//i)) {
    try {
      const resolveRes = await scraperFetch(
        { url, headers: { "User-Agent": "WhatsApp/2.21.19.21 A" }, rawResponse: true },
        "Spotify Link Resolver",
      );
      if (resolveRes) {
        if (resolveRes.url && !resolveRes.url.match(/spotify\.com\/s\//i)) {
          url = cleanUrl(resolveRes.url);
        } else if (resolveRes.data) {
          const htmlData = typeof resolveRes.data === "string" ? resolveRes.data : JSON.stringify(resolveRes.data);
          const ogMatch = htmlData.match(/<meta property="og:url" content="([^"]+)"/i);
          if (ogMatch && ogMatch[1]) {
            url = cleanUrl(ogMatch[1]);
          } else {
            const schemeMatch = htmlData.match(/<script id="urlSchemeConfig" type="text\/plain">([^<]+)<\/script>/);
            if (schemeMatch && schemeMatch[1]) {
              try {
                let b64 = schemeMatch[1];
                b64 = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
                const decoded = JSON.parse(atob(b64));
                if (decoded && decoded.redirectUrl) url = cleanUrl(decoded.redirectUrl);
              } catch (err) {}
            }
          }
        }
      }
    } catch (e) {
      console.warn("Failed to resolve Spotify short link", e);
    }
  }

  let currentStatus = null;
  let debugRawHtml = null;
  try {
    if (_spSource === "soundloaders") {
      const BASE = "https://soundloaders.app";
      let cookies = "";
      const now = Date.now();
      if (_slSessionCache && now - _slSessionCache.time < 5 * 60 * 1000) {
        cookies = _slSessionCache.cookies;
      } else {
        const r1 = await scraperFetch(
          { url: BASE + "/", headers: { "User-Agent": CHROME_UA, Accept: "*/*", "X-Requested-With": "XMLHttpRequest" }, rawResponse: true },
          "SoundLoaders Home",
        );
        currentStatus = r1.status;
        cookies = getCookiesFromHeaders(r1.headers);
        _slSessionCache = { cookies, time: now };
      }

      const formHeaders = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": CHROME_UA,
        "X-Requested-With": "XMLHttpRequest",
        Referer: BASE + "/",
        Origin: BASE,
      };
      if (cookies) formHeaders["Cookie"] = cookies;

      let token = "";
      try {
        const verifyRes = await scraperFetch(
          { url: BASE + "/api/userverify", method: "POST", data: serializeData({ url }), headers: formHeaders, rawResponse: true },
          "SoundLoaders Verify",
        );
        const vd = typeof verifyRes.data === "string" ? JSON.parse(verifyRes.data) : verifyRes.data;
        if (vd?.success && vd?.token) token = vd.token;
      } catch {}

      const actionRes = await scraperFetch(
        { url: BASE + "/action", method: "POST", data: serializeData({ url, cftoken: token }), headers: formHeaders, rawResponse: true },
        "SoundLoaders Action",
      );
      currentStatus = actionRes.status;
      let ad = typeof actionRes.data === "string" ? JSON.parse(actionRes.data) : actionRes.data;
      if (!ad || ad.status === false) throw new Error(ad?.error || "SoundLoaders returned failure.");
      debugRawHtml = ad.html || "";

      let parsed = parseSoundloadersTracks(ad.html || "");

      // For playlists/albums, SoundLoaders sometimes hasn't finished resolving
      // every track yet on the first response (some come back with no title,
      // or the list is shorter than it should be). Give it a moment and
      // re-ask once, keeping whichever result is more complete.
      const looksIncomplete =
        parsed.tracks.length > 1 &&
        (parsed.tracks.some((t) => !t.title) || parsed.tracks.length <= 2);

      if (looksIncomplete) {
        await new Promise((r) => setTimeout(r, 2800));
        try {
          const retryRes = await scraperFetch(
            { url: BASE + "/action", method: "POST", data: serializeData({ url, cftoken: token }), headers: formHeaders, rawResponse: true },
            "SoundLoaders Action Retry",
          );
          const ad2 = typeof retryRes.data === "string" ? JSON.parse(retryRes.data) : retryRes.data;
          if (ad2 && ad2.status !== false && ad2.html) {
            const parsed2 = parseSoundloadersTracks(ad2.html);
            const parsed2Better =
              parsed2.tracks.length > parsed.tracks.length ||
              (parsed2.tracks.length === parsed.tracks.length &&
                parsed2.tracks.filter((t) => t.title).length > parsed.tracks.filter((t) => t.title).length);
            if (parsed2Better) {
              parsed = parsed2;
              debugRawHtml = ad2.html;
            }
          }
        } catch {
          // keep the first result if the retry itself fails
        }
      }

      if (parsed.tracks.length === 0) throw new Error("No tracks found from SoundLoaders.");

      const downloads = [];
      const isPlaylistOrAlbum = parsed.tracks.length > 1;

      for (let i = 0; i < parsed.tracks.length; i++) {
        const track = parsed.tracks[i];
        const prefix = isPlaylistOrAlbum ? `${(i + 1).toString().padStart(String(parsed.tracks.length).length, "0")}. ` : "";
        const trackLabel = track.artist ? `${track.artist} - ${track.title}` : track.title;

        if (i === 0 && !isPlaylistOrAlbum) {
          try {
            const dlRes = await scraperFetch(
              { url: BASE + "/action/tracks", method: "POST", data: serializeData({ data: track.data, track_token: track.trackToken }), headers: formHeaders, rawResponse: true },
              "SoundLoaders Download",
            );
            let dd = typeof dlRes.data === "string" ? JSON.parse(dlRes.data) : dlRes.data;
            const trackDls = dd?.html ? parseSoundloadersDownloads(dd.html) : [];
            trackDls.forEach((td) => downloads.push({ ...td, type: isPlaylistOrAlbum ? `${prefix}${trackLabel} [MP3]` : "MP3" }));
          } catch (e) {}
        }

        if (downloads.length === 0 || isPlaylistOrAlbum) {
          downloads.push({ type: isPlaylistOrAlbum ? `${prefix}${trackLabel} [MP3]` : "MP3", url: `soundloaders_resolve:${track.data}|||${track.trackToken}` });
        }
      }

      if (downloads.length === 0) throw new Error("No download links found from SoundLoaders.");

      const typeSuffix = parsed.type === "playlist" ? " (Playlist)" : parsed.type === "album" ? " (Album)" : "";
      _spSource = null;
      return createScraperResult(true, {
        title: parsed.artist ? `${parsed.artist} - ${parsed.title}${typeSuffix}` : `${parsed.title}${typeSuffix}`,
        thumbnail: parsed.thumbnail,
        downloads,
        sourceUrl: url,
        ...(debug ? { debugRawHtml: (debugRawHtml || "").slice(0, 12000), debugTrackCount: parsed.tracks.length } : {}),
      });
    }

    // Default: SpotiDown
    let cookies = "";
    let baseData = {};
    const now = Date.now();

    if (_spSessionCache && now - _spSessionCache.time < 5 * 60 * 1000) {
      cookies = _spSessionCache.cookies;
      baseData = { ..._spSessionCache.baseData };
    } else {
      const r1 = await scraperFetch({ url: "https://spotidown.app/", headers: { "User-Agent": CHROME_UA }, rawResponse: true }, "SpotiDown Main");
      currentStatus = r1.status;
      cookies = getCookiesFromHeaders(r1.headers);

      const $1 = load(r1.data);
      $1('form[name="spotifyurl"] input').each((_, input) => {
        const name = $1(input).attr("name");
        const value = $1(input).attr("value") || "";
        if (name && name !== "url") baseData[name] = value;
      });
      _spSessionCache = { cookies, baseData, time: now };
    }

    const data = { ...baseData, url };
    data["g-recaptcha-response"] = "dummy_token";

    const r2Headers = {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": CHROME_UA,
      Origin: "https://spotidown.app",
      Referer: "https://spotidown.app/",
      "X-Requested-With": "XMLHttpRequest",
    };
    if (cookies) r2Headers["Cookie"] = cookies;

    const r2 = await scraperFetch({ url: "https://spotidown.app/action", method: "POST", data: serializeData(data), headers: r2Headers, rawResponse: true }, "SpotiDown Action");

    let r2Data = r2.data;
    if (typeof r2Data === "string") {
      try { r2Data = JSON.parse(r2Data); } catch (e) {}
    }
    if (r2Data.error) {
      _spSessionCache = null;
      throw new Error(r2Data.message || "Spotify error");
    }

    let finalHtml = r2Data.data || r2Data;
    debugRawHtml = typeof finalHtml === "string" ? finalHtml : JSON.stringify(finalHtml);
    const $2 = load(finalHtml);
    const forms2 = $2('form[name="submitspurl"]').toArray();

    const downloads = [];
    const r3Headers = {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": CHROME_UA,
      Origin: "https://spotidown.app",
      Referer: "https://spotidown.app/",
      "X-Requested-With": "XMLHttpRequest",
    };
    if (cookies) r3Headers["Cookie"] = cookies;

    const isMultiTrack = forms2.length > 1;

    for (let i = 0; i < forms2.length; i++) {
      const form2 = forms2[i];
      const data2 = {};
      $2(form2).find("input").each((_, input) => {
        const name = $2(input).attr("name");
        const value = $2(input).attr("value") || "";
        if (name) data2[name] = value;
      });
      data2["g-recaptcha-response"] = "dummy_token";
      const payloadStr = serializeData(data2);

      const prefix = isMultiTrack ? `${(i + 1).toString().padStart(String(forms2.length).length, "0")}. ` : "";

      let itemTitle = "";
      const dataVal = data2["data"];
      if (dataVal) {
        try {
          const dec = JSON.parse(atob(dataVal));
          const name = dec.name || dec.title || "";
          const artist = dec.artist || dec.singer || "";
          if (artist && name) itemTitle = `${artist} - ${name}`;
          else if (name) itemTitle = name;
        } catch (e) {}
      }
      if (!itemTitle) {
        const container = $2(form2).closest(".col-md-4, .col-sm-6, .card, .row, div");
        if (container.length) {
          const h = container.find("h3, h4, h5, .title, p").first();
          if (h.length && h.text().trim()) itemTitle = h.text().trim();
        }
      }

      if (i === 0 && !isMultiTrack) {
        try {
          const r3 = await scraperFetch({ url: "https://spotidown.app/action/track", method: "POST", data: payloadStr, headers: r3Headers, rawResponse: true }, "SpotiDown Track");
          let r3Data = r3.data;
          if (typeof r3Data === "string") {
            try { r3Data = JSON.parse(r3Data); } catch (e) {}
          }
          const trackHtml = r3Data.data || r3Data;
          const $3 = load(trackHtml);
          const trackTitle = $3("h3").first().text().trim();
          const artist = $3("p").first().text().trim();

          $3("a").each((_, a) => {
            const link = $3(a).attr("href");
            const text = $3(a).text().trim();
            if (link && link.startsWith("http") && !link.includes("premium.html") && text !== "Download Another Song") {
              const fullLabel = artist && trackTitle ? `${artist} - ${trackTitle}` : trackTitle || text || "MP3";
              const isCover = text.toLowerCase().includes("cover") || link.includes("cover");
              const typeLabel = isCover ? "[Cover]" : "[MP3]";
              downloads.push({ type: isMultiTrack ? `${prefix}${fullLabel} ${typeLabel}` : isCover ? "Cover" : "MP3", url: link });
            }
          });
        } catch (e) {}
      }

      if (downloads.length === 0 || isMultiTrack) {
        downloads.push({
          type: isMultiTrack ? `${prefix}${itemTitle || "Track " + (i + 1)} [MP3]` : "MP3",
          url: `spotidown_resolve:${payloadStr}|||${encodeURIComponent(cookies || "")}`,
        });
      }
    }

    if (downloads.length === 0) throw new Error("No download links found from SpotiDown.");

    downloads.sort((a, b) => {
      const aIsCover = (a.type || "").includes("[Cover]") || (a.type || "").toLowerCase() === "cover";
      const bIsCover = (b.type || "").includes("[Cover]") || (b.type || "").toLowerCase() === "cover";
      if (aIsCover && !bIsCover) return 1;
      if (!aIsCover && bIsCover) return -1;
      return 0;
    });

    const title = $2("h3").first().text().trim() || "Spotify Track";
    const artist = $2("p").first().text().trim();
    const thumbnail = $2("img").first().attr("src");

    _spSource = null;
    return createScraperResult(true, {
      title: artist ? `${artist} - ${title}` : title,
      thumbnail,
      downloads,
      sourceUrl: url,
      ...(debug ? { debugRawHtml: (debugRawHtml || "").slice(0, 12000), debugFormCount: forms2.length } : {}),
    });
  } catch (err) {
    _spSource = null;
    const result = createScraperResult(false, err.message, currentStatus);
    if (debug) result.debugRawHtml = (debugRawHtml || "").slice(0, 12000);
    return result;
  }
}

function parseSoundloadersTracks(html) {
  const $ = load(html);
  const out = { title: "", artist: "", thumbnail: "", type: "track", tracks: [] };

  out.thumbnail = $("img.rounded-xl").first().attr("src") || "";
  out.title = $("h2").first().text().trim();
  out.artist = $("p.text-sm.text-white\\/60.mb-8").first().text().trim();

  if (html.includes("playlist-songs") || html.includes("Playlist")) out.type = "playlist";
  else if (html.includes("Album")) out.type = "album";

  $('form[name="submitspurl"]').each((_, form) => {
    const track = { data: "", trackToken: "", title: "", artist: "", thumbnail: "" };
    track.data = $(form).find('input[name="data"]').attr("value") || "";
    track.trackToken = $(form).find('input[name="track_token"]').attr("value") || "";

    if (track.data) {
      try {
        const decoded = JSON.parse(atob(track.data));
        track.title = decoded.name || "";
        track.artist = decoded.artist || "";
        track.thumbnail = decoded.cover || "";
      } catch {}
    }

    if (!track.title) {
      const text = $(form).text().trim();
      if (text) {
        if (text.includes(" - ")) {
          const sp = text.split(" - ");
          track.artist = sp[0].trim();
          track.title = sp[1]?.trim() || "";
        } else {
          track.title = text;
        }
      }
    }
    out.tracks.push(track);
  });

  return out;
}

function parseSoundloadersDownloads(html) {
  const $ = load(html);
  const downloads = [];
  $("a").each((_, a) => {
    const link = ($(a).attr("href") || "").trim();
    const text = $(a).text().trim();
    if (link && link.startsWith("http") && text !== "Download Another Song" && !link.includes("tunecable.com") && !link.includes("premium")) {
      const isCover = text.toLowerCase().includes("cover") || link.includes("cover") || link.includes("scdn.co") || /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(link);
      downloads.push({ type: `${text || "Download"} ${isCover ? "[Cover]" : "[MP3]"}`, url: link });
    }
  });
  return downloads;
}

/* ===================== handler ===================== */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    let url = (req.query.url || "").trim();
    const source = (req.query.source || "spotidown").trim();

    if (!url) return res.status(400).json({ status: false, message: "Parameter url wajib diisi." });

    if (!/open\.spotify\.com/i.test(url)) {
      // not a Spotify link — treat it as a search keyword
      const resolvedUrl = await resolveKeywordToSpotifyUrl(url);
      if (!resolvedUrl) {
        return res.status(404).json({
          status: false,
          message: "Gak ketemu lagu buat kata kunci itu. Coba tempel link Spotify-nya langsung.",
        });
      }
      url = resolvedUrl;
    }

    url = cleanUrl(url);
    setSpotifySource(source === "soundloaders" ? "soundloaders" : "spotidown");

    const debug = req.query.debug === "1";
    const result = await scrapeSpotify(url, { debug });
    return res.status(result.status ? 200 : 502).json(result);
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message, stack: err.stack });
  }
}
