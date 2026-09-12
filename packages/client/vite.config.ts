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
        sprites: "sprites.html",
        bench: "bench.html",
      },
    },
  },
  worker: { format: "es" },
  // Pre-bundle the lazily imported pose runtime at server start. Without this the first "Enable camera" click
  // on a fresh dev server makes Vite optimise @mediapipe/tasks-vision on the fly and force a full page reload,
  // which drops the player back to the Join screen and out of the room.
  // onnxruntime-web (9.07) is left out of the pre-bundle: its ESM bundle resolves its wasm binary and thread
  // workers relative to import.meta.url, which the optimizer rewrites. The `.wasm` file is imported with `?url`
  // in backends/yolo.ts, so Vite serves it in dev and emits it as a hashed asset in the build.
  optimizeDeps: {
    include: ["@mediapipe/tasks-vision"],
    exclude: ["onnxruntime-web"],
    entries: ["index.html", "harness.html", "rig.html", "sprites.html", "bench.html", "src/vision/worker.ts"],
  },
});
