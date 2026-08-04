const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

/**
 * Resolve a Spotify playlist URL into its raw metadata + track list
 * via downloaderize.com's internal resolve endpoint.
 */
export async function resolvePlaylist(playlistUrl) {
  const upstream = await fetch("https://api.downloaderize.com/api/resolve", {
    method: "POST",
    headers: {
      "accept": "*/*",
      "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "content-type": "application/json",
      "origin": "https://spotify.downloaderize.com",
      "referer": "https://spotify.downloaderize.com/",
      "user-agent": UA
    },
    body: JSON.stringify({ url: playlistUrl })
  });

  const rawText = await upstream.text();

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    const err = new Error("Downloaderize tidak balikin JSON valid.");
    err.upstream_status = upstream.status;
    err.upstream_body = rawText.slice(0, 300);
    throw err;
  }

  return data;
}

/**
 * Resolve a single Spotify track URL into a direct MP3 download link
 * via musicfab.io's internal download endpoint.
 */
export async function resolveTrackDownload(trackUrl) {
  const upstream = await fetch("https://musicfab.io/api/spotify", {
    method: "POST",
    headers: {
      "accept": "*/*",
      "content-type": "application/json",
      "origin": "https://musicfab.io",
      "referer": "https://musicfab.io/",
      "user-agent": UA
    },
    body: JSON.stringify({ url: trackUrl })
  });

  const rawText = await upstream.text();

  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    const err = new Error("Musicfab tidak balikin JSON valid.");
    err.upstream_status = upstream.status;
    err.upstream_body = rawText.slice(0, 300);
    throw err;
  }

  const metadata = json?.data?.metadata;

  if (!metadata?.download) {
    const err = new Error("Gagal resolve link download dari Musicfab.");
    err.upstream = json;
    throw err;
  }

  return {
    title: metadata.title || "",
    artist: metadata.artist || "",
    cover: metadata.cover || metadata.image || "",
    download_url: metadata.download
  };
}
