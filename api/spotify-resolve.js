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

    const { url } = await resolveSpotifyDownload(token);

    return res.status(200).json({ status: true, url });

  } catch (err) {
    return res.status(502).json({
      status: false,
      message: err.message,
    });
  }
}
