// The scraper module calls `new DOMParser()` directly, which only exists
// natively in browsers. This makes an equivalent available as a global
// in the Node/Vercel serverless runtime, backed by linkedom.
import { DOMParser } from "linkedom";

if (typeof globalThis.DOMParser === "undefined") {
  globalThis.DOMParser = DOMParser;
}
