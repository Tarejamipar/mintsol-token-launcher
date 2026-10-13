import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Metaplex/Solana dependency imports Node's "crypto" module for SHA-256.
// Map that import to a browser-compatible implementation for the Vite bundle.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      crypto: "crypto-browserify"
    }
  }
});
