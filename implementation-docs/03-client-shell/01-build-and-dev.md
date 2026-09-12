# 3.01 — Vite, HTTPS dev, package

## Purpose
Client toolchain: Vite with a self-signed dev cert so the camera works on LAN, a `/ws` proxy to the server, COOP/COEP headers, multi-page build (game, harness, rig preview), ES-module workers.

## Files
Create: `packages/client/vite.config.ts`, `index.html` (shell with `#game`, `#lobby`, `#calibration`, `#result`, `#banner` and the base stylesheet), empty `harness.html` and `rig.html`, `package.json` scripts `dev` (`vite --host`), `build`, `preview`, `test`, `typecheck`, `vision:setup` (copies MediaPipe wasm to `public/wasm` and downloads `pose_landmarker_lite.task` to `public/models`).

## Depends on
Phase 0.

## Exposes
- Dev URL `https://<host>:5173`, proxied `/ws` → `ws://localhost:8080`.
- Build inputs: `index.html`, `harness.html`, `rig.html`.

## Behaviour
1. `@vitejs/plugin-basic-ssl` on; `server.host = true`.
2. Headers on dev responses: COOP `same-origin`, COEP `require-corp`.
3. `worker.format = "es"`.
4. Base stylesheet defines the palette as CSS variables (`--night-0` … `--danger`), the overlay layout (full-screen flex column, hidden attribute respected), button and input styles, and the top error banner. Font: system-ui, bold weights for headings.

## Invariants
- No absolute URLs to the server in client code; always same-origin `/ws`.

## Tests
- `pnpm --filter @midnight/client dev` serves `https://localhost:5173` with a certificate warning; `build` emits three HTML entries.

## Done when
- [ ] dev and build both work; typecheck clean
