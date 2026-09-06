export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/**
 * Pull a "Cookie:"-ready string out of a fetch Response's headers.
 * Handles both the modern multi-value getSetCookie() (Node 18.14+/20+)
 * and the older combined single-string fallback.
 */
export function getCookiesFromHeaders(headers) {
  if (!headers) return "";

  let raw = [];

  if (typeof headers.getSetCookie === "function") {
    raw = headers.getSetCookie();
  } else if (typeof headers.get === "function") {
    const single = headers.get("set-cookie");
    if (single) raw = single.split(/,(?=[^;]+=[^;]+)/); // best-effort split
  } else if (Array.isArray(headers)) {
    raw = headers;
  }

  return raw
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

