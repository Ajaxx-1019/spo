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
        upstream_body: err.upstream_body,
        upstream: err.upstream
      });
    }

    return res.status(200).json({
      status: true,
      ...info
    });

  } catch (err) {
    return res.status(500).json({
      status: false,
      message: err.message
    });
  }
}
