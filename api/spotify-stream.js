import axios from "axios";
import { load } from "cheerio";

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

async function scraperFetch(opts, label = "Request") {
  const { url, method = "GET", data, headers = {}, rawResponse = false } = opts;
  let response;
  try {
    response = await axios({
      url, method, data, headers,
      validateStatus: () => true,
      maxRedirects: 5,
      transformResponse: [(d) => d],
    });
  } catch (err) {
    throw new Error(`${label}: network error - ${err.message}`);
  }
  const finalUrl = response.request?.res?.responseUrl || response.config?.url || url;
  if (rawResponse) return { status: response.status, headers: response.headers, data: response.data, url: finalUrl };
  if (response.status < 200 || response.status >= 300) {
    const err = new Error(`${label} failed with status ${response.status}`);
    err.status = response.status;
    err.body = response.data;
    throw err;
  }
  try { return JSON.parse(response.data); } catch { return response.data; }
}

async function resolveSpotifyDownload(token) {
  if (token.startsWith("soundloaders_resolve:")) return resolveSoundloaders(token.slice("soundloaders_resolve:".length));
  if (token.startsWith("spotidown_resolve:")) return resolveSpotidown(token.slice("spotidown_resolve:".length));
  return { url: token };
}

async function resolveSoundloaders(payload) {
  const [data, trackToken] = payload.split("|||");
  const BASE = "https://soundloaders.app";

  const r1 = await scraperFetch(
    { url: BASE + "/", headers: { "User-Agent": CHROME_UA, Accept: "*/*", "X-Requested-With": "XMLHttpRequest" }, rawResponse: true },
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
    { url: BASE + "/action/tracks", method: "POST", data: serializeData({ data, track_token: trackToken }), headers, rawResponse: true },
    "SoundLoaders Resolve Download",
  );

  let dd;
  try { dd = JSON.parse(dlRes.data); } catch { throw new Error("SoundLoaders resolve: response tidak valid."); }

  const $ = load(dd?.html || "");
  const href = $("a").first().attr("href");
  if (!href) throw new Error("SoundLoaders resolve: link tidak ditemukan.");
  return { url: href };
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
    { url: "https://spotidown.app/action/track", method: "POST", data: payloadStr, headers, rawResponse: true },
    "SpotiDown Resolve Track",
  );

  let r3Data = r3.data;
  try { r3Data = JSON.parse(r3Data); } catch {}

  const trackHtml = r3Data?.data || r3Data || "";
  const $ = load(trackHtml);

  let found = null;
  $("a").each((_, a) => {
    if (found) return;
    const href = $(a).attr("href");
    const text = $(a).text().trim();
    if (href && href.startsWith("http") && !href.includes("premium.html") && text !== "Download Another Song") found = href;
  });

  if (!found) throw new Error("SpotiDown resolve: link tidak ditemukan.");
  return { url: found };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const token = (req.query.token || "").trim();
    if (!token) return res.status(400).json({ status: false, message: "Parameter token wajib diisi." });

    let directUrl;
    try {
      const resolved = await resolveSpotifyDownload(token);
      directUrl = resolved.url;
    } catch (err) {
      return res.status(502).json({ status: false, message: err.message, stack: err.stack });
    }

    const mp3 = await axios.get(directUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      responseType: "arraybuffer",
      validateStatus: () => true,
    });

    if (mp3.status < 200 || mp3.status >= 300) {
      return res.status(500).json({ status: false, message: "Gagal mengambil file MP3." });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public,max-age=3600");
    return res.status(200).send(Buffer.from(mp3.data));
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message, stack: err.stack });
  }
}
