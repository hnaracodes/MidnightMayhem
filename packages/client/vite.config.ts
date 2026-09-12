import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true,
    headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
    proxy: { "/ws": { target: "ws://localhost:8080", ws: true } },
  },
  build: {
    rollupOptions: {
      input: {
        game: "index.html",
        harness: "harness.html",
        rig: "rig.html",
      },
    },
  },
  worker: { format: "es" },
});
