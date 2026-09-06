import { setSpotifySource, scrapeSpotify } from "../lib/scrapers/spotify.js";
import { cleanUrl } from "../lib/utils/index.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    let url = (req.query.url || "").trim();
    const source = (req.query.source || "spotidown").trim();

    if (!url) {
      return res.status(400).json({
        status: false,
        message: "Parameter url wajib diisi.",
      });
    }

    if (!/open\.spotify\.com/i.test(url)) {
      return res.status(400).json({
        status: false,
        message: "Link yang dimasukkan bukan link Spotify.",
      });
    }

    url = cleanUrl(url);

    setSpotifySource(source === "soundloaders" ? "soundloaders" : "spotidown");

    const result = await scrapeSpotify(url);

    if (!result.status) {
      return res.status(502).json(result);
    }

    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({
      status: false,
      message: err.message,
    });
  }
}
