import { resolvePlaylist } from "./_lib/musicfab.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    let url = (req.query.url || "").trim();

    if (!url) {
      return res.status(400).json({
        status: false,
        message: "Parameter url wajib diisi."
      });
    }

    // Bersihin tracking params (si, utm_source, pi, dll) biar URL-nya rapi
    try {
      const u = new URL(url);
      url = `${u.origin}${u.pathname}`;
    } catch {
      // bukan URL valid, biarin apa adanya
    }

    let data;
    try {
      data = await resolvePlaylist(url);
    } catch (err) {
      return res.status(502).json({
        status: false,
        message: err.message,
        upstream_status: err.upstream_status,
        upstream_body: err.upstream_body
      });
    }

    const rawTracks = data?.tracks || [];

    if (!rawTracks.length) {
      return res.status(404).json({
        status: false,
        message: "Playlist tidak ditemukan atau kosong.",
        upstream: data
      });
    }

    const tracks = rawTracks.map((t) => ({
      cover: t.cover || t.image || t.thumbnail || "",
      title: t.title || t.name || "Unknown",
      artist: t.artist || t.artists || "Unknown",
      album: t.album || "",
      duration: t.duration || "",
      // dipakai frontend buat resolve download/stream lewat musicfab
      spotify_url: t.spotify_url || t.url || t.external_url || ""
    }));

    return res.status(200).json({
      status: true,
      cover: data.cover || data.image || "",
      title: data.name || "Playlist",
      description: data.description || "",
      owner: data.owner || "",
      total: data.total || tracks.length,
      tracks
    });

  } catch (err) {
    return res.status(500).json({
      status: false,
      message: err.message
    });
  }
}
