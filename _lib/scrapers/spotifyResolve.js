import { CHROME_UA, getCookiesFromHeaders, serializeData } from "../utils/index.js";
import { scraperFetch } from "./httpHelper.js";

/**
 * Takes either a real http(s) URL (already resolved) or one of the lazy
 * placeholder tokens the scraper hands back for playlist/album tracks,
 * and returns { url } pointing at the actual MP3.
 */
export async function resolveSpotifyDownload(token) {
  if (token.startsWith("soundloaders_resolve:")) {
    return resolveSoundloaders(token.slice("soundloaders_resolve:".length));
  }
  if (token.startsWith("spotidown_resolve:")) {
    return resolveSpotidown(token.slice("spotidown_resolve:".length));
  }
  // already a direct URL, nothing to resolve
  return { url: token };
}

async function resolveSoundloaders(payload) {
  const [data, trackToken] = payload.split("|||");
  const BASE = "https://soundloaders.app";

  // fresh session cookie so the download call is authorized
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
    "SoundLoaders Resolve Session",
  );
  const cookies = getCookiesFromHeaders(r1.headers);

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "User-Agent": CHROME_UA,
    "X-Requested-With": "XMLHttpRequest",
    Referer: BASE + "/",
    Origin: BASE,
  };
  if (cookies) headers["Cookie"] = cookies;

  const dlRes = await scraperFetch(
    {
      url: BASE + "/action/tracks",
      method: "POST",
      data: serializeData({ data, track_token: trackToken }),
      headers,
      rawResponse: true,
    },
    "SoundLoaders Resolve Download",
  );

  let dd;
  try {
    dd = JSON.parse(dlRes.data);
  } catch {
    throw new Error("SoundLoaders resolve: response tidak valid.");
  }

  const html = dd?.html || "";
  const match = html.match(/<a\s[^>]*href=["']([^"']+)["']/i);
  if (!match) throw new Error("SoundLoaders resolve: link tidak ditemukan.");

  return { url: match[1] };
}

async function resolveSpotidown(payload) {
  const [payloadStr, encodedCookies] = payload.split("|||");
  const cookies = encodedCookies ? decodeURIComponent(encodedCookies) : "";

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "User-Agent": CHROME_UA,
    Origin: "https://spotidown.app",
    Referer: "https://spotidown.app/",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (cookies) headers["Cookie"] = cookies;

  const r3 = await scraperFetch(
    {
      url: "https://spotidown.app/action/track",
      method: "POST",
      data: payloadStr,
      headers,
      rawResponse: true,
    },
    "SpotiDown Resolve Track",
  );

  let r3Data = r3.data;
  try {
    r3Data = JSON.parse(r3Data);
  } catch {
    // keep as raw text
  }

  const trackHtml = r3Data?.data || r3Data || "";

  const aRe = /<a\s[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(trackHtml)) !== null) {
    const link = m[1];
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    if (!link.includes("premium.html") && text !== "Download Another Song") {
      return { url: link };
    }
  }

  throw new Error("SpotiDown resolve: link tidak ditemukan.");
}
