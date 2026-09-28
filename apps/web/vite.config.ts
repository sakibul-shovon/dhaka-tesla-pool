import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// maplibre-gl's own runtime code finds its worker by taking
// import.meta.url of whichever file it ends up bundled into and looking
// for a sibling literally named "maplibre-gl-worker.mjs" — a convention
// that only holds when maplibre-gl.mjs keeps its real filename. Vite's
// production build folds it into one content-hashed chunk instead, so
// that sibling file never existed in `dist/assets/` — the worker request
// 404s, Netlify's SPA fallback serves index.html for it, and the browser
// (correctly) refuses to run HTML as a JS module. Copying the file in
// under its exact expected name after the build restores the sibling
// maplibre-gl itself relies on; dev is unaffected (optimizeDeps.exclude
// below already keeps maplibre-gl's real files intact there).
function copyMaplibreWorker(): Plugin {
  return {
    name: "copy-maplibre-worker",
    apply: "build",
    closeBundle() {
      const workerPath = fileURLToPath(import.meta.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs"));
      const outDir = join(dirname(fileURLToPath(import.meta.url)), "dist/assets");
      mkdirSync(outDir, { recursive: true });
      copyFileSync(workerPath, join(outDir, "maplibre-gl-worker.mjs"));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyMaplibreWorker()],
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
