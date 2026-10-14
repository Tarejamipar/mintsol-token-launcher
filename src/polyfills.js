import { Buffer } from "buffer";

// Some Solana/Metaplex dependencies expect Node.js Buffer in the browser.
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}
