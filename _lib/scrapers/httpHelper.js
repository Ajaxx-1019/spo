import axios from "axios";

/**
 * Thin axios wrapper used by the scrapers.
 * - rawResponse: true  -> always returns { status, headers, data (raw text), url }
 * - rawResponse: false -> returns parsed JSON (or raw text if not JSON), throws on !ok
 */
export async function scraperFetch(opts, label = "Request") {
  const { url, method = "GET", data, headers = {}, rawResponse = false } = opts;

  let response;
  try {
    response = await axios({
      url,
      method,
      data,
      headers,
      // don't throw on non-2xx — the scrapers inspect status themselves
      validateStatus: () => true,
      maxRedirects: 5,
      // keep the body as a raw string; we parse JSON ourselves so the
      // calling code's `typeof x === "string" ? JSON.parse(x) : x`
      // checks behave the same as they did against fetch's res.text()
      transformResponse: [(d) => d],
    });
  } catch (err) {
    throw new Error(`${label}: network error - ${err.message}`);
  }

  const finalUrl =
    response.request?.res?.responseUrl || response.config?.url || url;

  if (rawResponse) {
    return {
      status: response.status,
      headers: response.headers,
      data: response.data,
      url: finalUrl,
    };
  }

  if (response.status < 200 || response.status >= 300) {
    const err = new Error(`${label} failed with status ${response.status}`);
    err.status = response.status;
    err.body = response.data;
    throw err;
  }

  try {
    return JSON.parse(response.data);
  } catch {
    return response.data;
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
    httpStatus: status ?? null,
  };
}
