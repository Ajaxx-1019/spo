/**
 * Thin fetch wrapper used by the scrapers.
 * - rawResponse: true  -> always returns { status, headers, data (raw text), url }
 * - rawResponse: false -> returns parsed JSON (or raw text if not JSON), throws on !ok
 */
export async function scraperFetch(opts, label = "Request") {
  const { url, method = "GET", data, headers = {}, rawResponse = false } = opts;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method !== "GET" && method !== "HEAD" ? data : undefined,
      redirect: "follow"
    });
  } catch (err) {
    throw new Error(`${label}: network error - ${err.message}`);
  }

  const text = await response.text();

  if (rawResponse) {
    return {
      status: response.status,
      headers: response.headers,
      data: text,
      url: response.url
    };
  }

  if (!response.ok) {
    const err = new Error(`${label} failed with status ${response.status}`);
    err.status = response.status;
    err.body = text;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Normalize a scraper's outcome into a consistent API response shape */
export function createScraperResult(success, dataOrMessage, status) {
  if (success) {
    return { status: true, ...dataOrMessage };
  }
  return {
    status: false,
    message: typeof dataOrMessage === "string" ? dataOrMessage : "Terjadi kesalahan.",
    httpStatus: status ?? null
  };
}
