import { resolveSpotifyDownload } from "../lib/scrapers/spotifyResolve.js";

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const token = (req.query.token || "").trim();

    if (!token) {
      return res.status(400).json({
        status: false,
        message: "Parameter token wajib diisi.",
      });
    }

    let directUrl;
    try {
      const resolved = await resolveSpotifyDownload(token);
      directUrl = resolved.url;
    } catch (err) {
      return res.status(502).json({ status: false, message: err.message });
    }

    const mp3 = await fetch(directUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!mp3.ok) {
      return res.status(500).json({
        status: false,
        message: "Gagal mengambil file MP3.",
      });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public,max-age=3600");

    const buffer = Buffer.from(await mp3.arrayBuffer());

    return res.status(200).send(buffer);

  } catch (err) {
    return res.status(500).json({
      status: false,
      message: err.message,
    });
  }
}
