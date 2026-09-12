import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

// MM_HTTP=1 serves plain http (localhost is a secure context, so the camera still works) for headless
// screenshot runs; MM_SERVER_PORT points the /ws proxy at a server started with PORT=<n>.
const http = process.env.MM_HTTP === "1";
const serverPort = process.env.MM_SERVER_PORT ?? "8080";

export default defineConfig({
  plugins: http ? [] : [basicSsl()],
  server: {
    host: true,
    strictPort: true,
    headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
    proxy: { "/ws": { target: `ws://localhost:${serverPort}`, ws: true } },
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
