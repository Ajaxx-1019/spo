export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/**
 * Pull a "Cookie:"-ready string out of an axios response's headers
 * (axios exposes "set-cookie" as a plain array under a lowercase key).
 */
export function getCookiesFromHeaders(headers) {
  if (!headers) return "";

  const raw = headers["set-cookie"] || headers["Set-Cookie"] || [];
  const arr = Array.isArray(raw) ? raw : [raw];

  return arr
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

/** application/x-www-form-urlencoded serializer */
export function serializeData(obj) {
  return Object.entries(obj || {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? "")}`)
    .join("&");
}

/** Strip tracking query params (si, utm_source, pi, ...) off a Spotify link */
export function cleanUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}
