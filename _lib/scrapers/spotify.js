import {
  CHROME_UA,
  getCookiesFromHeaders,
  serializeData,
  cleanUrl,
} from "../utils/index.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export let _spSource = null;
let _slSessionCache = null;
let _spSessionCache = null;

export function setSpotifySource(source) {
  _spSource = source;
}

export async function scrapeSpotify(url) {
  if (!_spSource) {
    return { status: true, requireSource: true };
  }

  if (url.match(/spotify\.com\/s\//i)) {
    try {
      const resolveRes = await scraperFetch(
        {
          url: url,
          headers: { "User-Agent": "WhatsApp/2.21.19.21 A" },
          rawResponse: true,
        },
        "Spotify Link Resolver",
      );
      if (resolveRes) {
        if (resolveRes.url && !resolveRes.url.match(/spotify\.com\/s\//i)) {
          url = cleanUrl(resolveRes.url);
        } else if (resolveRes.data) {
          const htmlData =
            typeof resolveRes.data === "string"
              ? resolveRes.data
              : JSON.stringify(resolveRes.data);
          const ogMatch = htmlData.match(
            /<meta property="og:url" content="([^"]+)"/i,
          );
          if (ogMatch && ogMatch[1]) {
            url = cleanUrl(ogMatch[1]);
          } else {
            const schemeMatch = htmlData.match(
              /<script id="urlSchemeConfig" type="text\/plain">([^<]+)<\/script>/,
            );
            if (schemeMatch && schemeMatch[1]) {
              try {
                let b64 = schemeMatch[1];
                b64 = b64.padEnd(
                  b64.length + ((4 - (b64.length % 4)) % 4),
                  "=",
                );
                const decoded = JSON.parse(atob(b64));
                if (decoded && decoded.redirectUrl) {
                  url = cleanUrl(decoded.redirectUrl);
                }
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
  try {
    if (_spSource === "soundloaders") {
      const BASE = "https://soundloaders.app";

      let cookies = "";
      const now = Date.now();
      if (_slSessionCache && now - _slSessionCache.time < 5 * 60 * 1000) {
        cookies = _slSessionCache.cookies;
      } else {
        const r1 = await scraperFetch(
          {
            url: BASE + "/",
            headers: {
              "User-Agent": CHROME_UA,
              Accept: "*/*",
              "X-Requested-With": "XMLHttpRequest",
            },
            rawResponse: true,
          },
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
          {
            url: BASE + "/api/userverify",
            method: "POST",
            data: serializeData({ url }),
            headers: formHeaders,
            rawResponse: true,
          },
          "SoundLoaders Verify",
        );
        const vd =
          typeof verifyRes.data === "string"
            ? JSON.parse(verifyRes.data)
            : verifyRes.data;
        if (vd?.success && vd?.token) token = vd.token;
      } catch {
        // proceed with empty token
      }

      const actionRes = await scraperFetch(
        {
          url: BASE + "/action",
          method: "POST",
          data: serializeData({ url, cftoken: token }),
          headers: formHeaders,
          rawResponse: true,
        },
        "SoundLoaders Action",
      );
      currentStatus = actionRes.status;
      let ad =
        typeof actionRes.data === "string"
          ? JSON.parse(actionRes.data)
          : actionRes.data;
      if (!ad || ad.status === false) {
        throw new Error(ad?.error || "SoundLoaders returned failure.");
      }

      const actionHtml = ad.html || "";
      const parsed = parseSoundloadersTracks(actionHtml);

      if (parsed.tracks.length === 0) {
        throw new Error("No tracks found from SoundLoaders.");
      }

      // Instant Playlist Parsing (Instant < 1s UI response)
      const downloads = [];
      const isPlaylistOrAlbum = parsed.tracks.length > 1;

      for (let i = 0; i < parsed.tracks.length; i++) {
        const track = parsed.tracks[i];
        const prefix = isPlaylistOrAlbum
          ? `${(i + 1).toString().padStart(String(parsed.tracks.length).length, "0")}. `
          : "";
        const trackLabel = track.artist
          ? `${track.artist} - ${track.title}`
          : track.title;

        if (i === 0 && !isPlaylistOrAlbum) {
          // Single track: fetch direct download URL immediately
          try {
            const dlRes = await scraperFetch(
              {
                url: BASE + "/action/tracks",
                method: "POST",
                data: serializeData({
                  data: track.data,
                  track_token: track.trackToken,
                }),
                headers: formHeaders,
                rawResponse: true,
              },
              "SoundLoaders Download",
            );
            let dd =
              typeof dlRes.data === "string"
                ? JSON.parse(dlRes.data)
                : dlRes.data;
            let dlHtml = dd?.html || "";
            const trackDls = dlHtml ? parseSoundloadersDownloads(dlHtml) : [];
            trackDls.forEach((td) => {
              downloads.push({
                ...td,
                type: isPlaylistOrAlbum
                  ? `${prefix}${trackLabel} [MP3]`
                  : "MP3",
              });
            });
          } catch (e) {}
        }

        // Lazy resolve fallback for playlist items
        if (downloads.length === 0 || isPlaylistOrAlbum) {
          downloads.push({
            type: isPlaylistOrAlbum
              ? `${prefix}${trackLabel} [MP3]`
              : "MP3",
            url: `soundloaders_resolve:${track.data}|||${track.trackToken}`,
          });
        }
      }

      if (downloads.length === 0) {
        throw new Error("No download links found from SoundLoaders.");
      }

      const typeSuffix =
        parsed.type === "playlist"
          ? " (Playlist)"
          : parsed.type === "album"
            ? " (Album)"
            : "";
      _spSource = null;
      return createScraperResult(true, {
        title: parsed.artist
          ? `${parsed.artist} - ${parsed.title}${typeSuffix}`
          : `${parsed.title}${typeSuffix}`,
        thumbnail: parsed.thumbnail,
        downloads,
        sourceUrl: url,
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
      const r1 = await scraperFetch(
        {
          url: "https://spotidown.app/",
          headers: { "User-Agent": CHROME_UA },
          rawResponse: true,
        },
        "SpotiDown Main",
      );
      currentStatus = r1.status;
      cookies = getCookiesFromHeaders(r1.headers);

      const formInputs = extractFirstFormInputs(r1.data, "spotifyurl");
      for (const [name, value] of Object.entries(formInputs)) {
        if (name !== "url") baseData[name] = value;
      }
      _spSessionCache = { cookies, baseData, time: now };
    }

    const data = { ...baseData, url: url };
    data["g-recaptcha-response"] = "dummy_token";

    const r2Headers = {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": CHROME_UA,
      Origin: "https://spotidown.app",
      Referer: "https://spotidown.app/",
      "X-Requested-With": "XMLHttpRequest",
    };
    if (cookies) r2Headers["Cookie"] = cookies;

    const r2 = await scraperFetch(
      {
        url: "https://spotidown.app/action",
        method: "POST",
        data: serializeData(data),
        headers: r2Headers,
        rawResponse: true,
      },
      "SpotiDown Action",
    );

    let r2Data = r2.data;
    if (typeof r2Data === "string") {
      try {
        r2Data = JSON.parse(r2Data);
      } catch (e) {}
    }

    if (r2Data.error) {
      _spSessionCache = null;
      throw new Error(r2Data.message || "Spotify error");
    }

    let finalHtml = r2Data.data || r2Data;
    const forms2 = extractFormsWithContext(finalHtml, "submitspurl");

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
      const { inner, before } = forms2[i];
      const data2 = extractInputsFromBlock(inner);
      data2["g-recaptcha-response"] = "dummy_token";
      const payloadStr = serializeData(data2);

      const prefix = isMultiTrack
        ? `${(i + 1).toString().padStart(String(forms2.length).length, "0")}. `
        : "";

      // Extract track title from base64 data input, or nearby heading as fallback
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
        itemTitle = findNearbyHeading(before);
      }

      if (i === 0 && !isMultiTrack) {
        // Fetch track 1 immediately for single track
        try {
          const r3 = await scraperFetch(
            {
              url: "https://spotidown.app/action/track",
              method: "POST",
              data: payloadStr,
              headers: r3Headers,
              rawResponse: true,
            },
            "SpotiDown Track",
          );
          let r3Data = r3.data;
          if (typeof r3Data === "string") {
            try {
              r3Data = JSON.parse(r3Data);
            } catch (e) {}
          }
          const trackHtml = r3Data.data || r3Data;

          const trackTitle = matchFirstTag(trackHtml, "h3");
          const artist = matchFirstTag(trackHtml, "p");

          extractAnchors(trackHtml).forEach(({ href, text }) => {
            if (
              href &&
              href.startsWith("http") &&
              !href.includes("premium.html") &&
              text !== "Download Another Song"
            ) {
              const fullLabel =
                artist && trackTitle
                  ? `${artist} - ${trackTitle}`
                  : trackTitle || text || "MP3";

              const isCover =
                text.toLowerCase().includes("cover") || href.includes("cover");
              const typeLabel = isCover ? "[Cover]" : "[MP3]";

              downloads.push({
                type: isMultiTrack
                  ? `${prefix}${fullLabel} ${typeLabel}`
                  : isCover
                    ? "Cover"
                    : "MP3",
                url: href,
              });
            }
          });
        } catch (e) {}
      }

      // Add lazy resolver link for playlist items or fallback
      if (downloads.length === 0 || isMultiTrack) {
        downloads.push({
          type: isMultiTrack
            ? `${prefix}${itemTitle || "Track " + (i + 1)} [MP3]`
            : "MP3",
          url: `spotidown_resolve:${payloadStr}|||${encodeURIComponent(cookies || "")}`,
        });
      }
    }

    if (downloads.length === 0) {
      throw new Error("No download links found from SpotiDown.");
    }

    // Prioritize MP3 audio files over album cover images
    downloads.sort((a, b) => {
      const aIsCover =
        (a.type || "").includes("[Cover]") ||
        (a.type || "").toLowerCase() === "cover";
      const bIsCover =
        (b.type || "").includes("[Cover]") ||
        (b.type || "").toLowerCase() === "cover";
      if (aIsCover && !bIsCover) return 1;
      if (!aIsCover && bIsCover) return -1;
      return 0;
    });

    const title = matchFirstTag(finalHtml, "h3") || "Spotify Track";
    const artist = matchFirstTag(finalHtml, "p");
    const thumbnail = extractImgSrc(finalHtml);

    _spSource = null;
    return createScraperResult(true, {
      title: artist ? `${artist} - ${title}` : title,
      thumbnail,
      downloads,
      sourceUrl: url,
    });
  } catch (err) {
    _spSource = null;
    return createScraperResult(false, err.message, currentStatus);
  }
}

function parseSoundloadersTracks(html) {
  const out = {
    title: "",
    artist: "",
    thumbnail: "",
    type: "track",
    tracks: [],
  };

  // Thumbnail: img with rounded-xl class
  const imgRe =
    /<img[^>]+src=["']([^"']+)["'][^>]*class=["'][^"']*rounded-xl[^"']*["']/i;
  const imgM = html.match(imgRe);
  if (imgM) out.thumbnail = imgM[1];

  // Title: <h2 ...>...</h2>
  const h2Re = /<h2[^>]*>([\s\S]*?)<\/h2>/i;
  const h2M = html.match(h2Re);
  if (h2M) out.title = stripHtml(h2M[1]);

  // Artist: paragraph after h2
  const pRe = /<p class="text-sm text-white\/60 mb-8">([\s\S]*?)<\/p>/i;
  const pM = html.match(pRe);
  if (pM) out.artist = stripHtml(pM[1]);

  if (html.includes("playlist-songs") || html.includes("Playlist")) {
    out.type = "playlist";
  } else if (html.includes("Album")) {
    out.type = "album";
  }

  // Extract each track form
  const formRe = /<form[^>]*name=["']submitspurl["'][^>]*>([\s\S]*?)<\/form>/gi;
  let fm;
  while ((fm = formRe.exec(html)) !== null) {
    const fh = fm[1];
    const track = {
      data: "",
      trackToken: "",
      title: "",
      artist: "",
      thumbnail: "",
    };

    const dataM = fh.match(
      /<input[^>]+name=["']data["'][^>]+value=["']([^"']*)["']/,
    );
    if (dataM) track.data = dataM[1];
    const tokM = fh.match(
      /<input[^>]+name=["']track_token["'][^>]+value=["']([^"']*)["']/,
    );
    if (tokM) track.trackToken = tokM[1];

    // Decode base64 data to get track info
    if (track.data) {
      try {
        const decoded = JSON.parse(atob(track.data));
        track.title = decoded.name || "";
        track.artist = decoded.artist || "";
        track.thumbnail = decoded.cover || "";
      } catch {}
    }

    // Fallback: parse from nearby text
    if (!track.title) {
      const texts = fh.match(/>([^<]+)</g);
      if (texts) {
        for (const t of texts) {
          const clean = t.replace(/[><]/g, "").trim();
          if (clean && clean.length > 2 && clean !== "Download") {
            if (clean.includes(" - ")) {
              const sp = clean.split(" - ");
              track.artist = sp[0].trim();
              track.title = sp[1]?.trim() || "";
            } else if (!track.title) {
              track.title = clean;
            }
          }
        }
      }
    }

    out.tracks.push(track);
  }

  return out;
}

function parseSoundloadersDownloads(html) {
  const downloads = [];
  const aRe = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(html)) !== null) {
    const link = m[1].trim();
    const text = stripHtml(m[2]);

    if (
      link &&
      link.startsWith("http") &&
      text !== "Download Another Song" &&
      !link.includes("tunecable.com") &&
      !link.includes("premium")
    ) {
      const isCover =
        text.toLowerCase().includes("cover") ||
        link.includes("cover") ||
        link.includes("scdn.co") ||
        link.match(/\.(jpg|jpeg|png|webp)(\?.*)?$/i);
      const typeLabel = isCover ? "[Cover]" : "[MP3]";

      downloads.push({
        type: `${text || "Download"} ${typeLabel}`,
        url: link,
      });
    }
  }
  return downloads;
}

function stripHtml(s) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

/* ---------- Regex-based mini "DOM" helpers (no DOMParser needed) ---------- */

function extractInputsFromBlock(html) {
  const inputs = {};
  const inputRe = /<input\b[^>]*>/gi;
  let m;
  while ((m = inputRe.exec(html)) !== null) {
    const tag = m[0];
    const nameM = tag.match(/name=["']([^"']*)["']/i);
    if (!nameM) continue;
    const valueM = tag.match(/value=["']([^"']*)["']/i);
    inputs[nameM[1]] = valueM ? valueM[1] : "";
  }
  return inputs;
}

function extractFirstFormInputs(html, formName) {
  const re = new RegExp(
    `<form[^>]*name=["']${formName}["'][^>]*>([\\s\\S]*?)<\\/form>`,
    "i",
  );
  const m = html.match(re);
  return m ? extractInputsFromBlock(m[1]) : {};
}

/** Extracts every <form name="X">...</form> block plus the HTML right
 *  before it (used as a fallback context to hunt for a nearby title). */
function extractFormsWithContext(html, formName, contextChars = 400) {
  const results = [];
  const openRe = new RegExp(`<form[^>]*name=["']${formName}["'][^>]*>`, "gi");
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const openStart = m.index;
    const openEnd = openRe.lastIndex;
    const closeIdx = html.indexOf("</form>", openEnd);
    if (closeIdx === -1) continue;
    results.push({
      inner: html.slice(openEnd, closeIdx),
      before: html.slice(Math.max(0, openStart - contextChars), openStart),
    });
    openRe.lastIndex = closeIdx + 7;
  }
  return results;
}

function findNearbyHeading(text) {
  const re = /<(h3|h4|h5|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  let last = "";
  while ((m = re.exec(text)) !== null) {
    const clean = stripHtml(m[2]);
    if (clean) last = clean;
  }
  return last;
}

function matchFirstTag(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = html.match(re);
  return m ? stripHtml(m[1]) : "";
}

function extractAnchors(html) {
  const out = [];
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ href: m[1].trim(), text: stripHtml(m[2]) });
  }
  return out;
}

function extractImgSrc(html) {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : "";
}
