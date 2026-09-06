// The scraper module calls `new DOMParser()` directly, which only exists
// natively in browsers. This makes an equivalent available as a global
// in the Node/Vercel serverless runtime, backed by linkedom.
//
// Using a namespace import here (instead of `import { DOMParser } from
// "linkedom"`) avoids a CJS/ESM interop crash: linkedom ships both a
// CJS and ESM build, and Node's static named-export detection for CJS
// packages can fail depending on how the function gets bundled, which
// crashes the whole serverless function before our own try/catch ever
// runs (that's the "A server error has occurred" page).
import * as linkedom from "linkedom";

const DOMParserImpl = linkedom.DOMParser;

if (typeof globalThis.DOMParser === "undefined") {
  globalThis.DOMParser = DOMParserImpl;
}

