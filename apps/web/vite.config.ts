import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // maplibre-gl's worker is bundled by Vite itself (the `?worker&url` import
  // in components/map/ZoneMap.tsx), and maplibre-gl starts it as a module
  // worker (`new Worker(url, { type: "module" })`) — so emit it as an ES
  // module to match, rather than Vite's default classic-script (iife) format.
  worker: {
    format: "es",
  },
  // maplibre-gl constructs its tile-parsing Worker from a URL that breaks
  // once Vite's dep optimizer rewrites the module into .vite/deps — the
  // worker 404s and the map silently renders no tiles. Excluding it from
  // pre-bundling keeps its own worker URL intact.
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  server: {
    proxy: {
      // Same-origin in dev too, so cookies behave the same as production's
      // nginx proxy (plan §13.3) — no CORS headers to reason about.
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
  },
});
