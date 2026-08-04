import { resolveTrackDownload } from "./_lib/musicfab.js";

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {

    const url = (req.query.url || "").trim();

    if (!url) {
      return res.status(400).json({
        status: false,
        message: "Parameter url wajib diisi."
      });
    }

    let info;
    try {
      info = await resolveTrackDownload(url);
    } catch (err) {
      return res.status(502).json({
        status: false,
        message: err.message,
        upstream_status: err.upstream_status,
        upstream_body: err.upstream_body
      });
    }

    const mp3 = await fetch(info.download_url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (!mp3.ok) {
      return res.status(500).json({
        status: false,
        message: "Gagal mengambil file MP3."
      });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public,max-age=3600");

    const buffer = Buffer.from(await mp3.arrayBuffer());

    return res.status(200).send(buffer);

  } catch (err) {
    return res.status(500).json({
      status: false,
      message: err.message
    });
  }
}
