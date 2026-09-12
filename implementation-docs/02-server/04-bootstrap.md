# 2.04 — HTTPS bootstrap, certs, static hosting

## Purpose
The process entry: serve `packages/client/dist` and upgrade `/ws`, over HTTPS when a self-signed cert exists (camera needs a secure context on the second laptop), else HTTP for localhost.

## Files
Create: `packages/server/src/index.ts`, `packages/server/src/certs.ts`, `packages/server/scripts/make-cert.sh`. Scripts in `package.json`: `dev` (tsx watch), `start` (tsx), `cert`.

## Depends on
2.03.

## Exposes
- `loadCerts(): { key, cert } | null` reading `packages/server/certs/{key,cert}.pem`
- `PORT` env (default 8080)

## Behaviour
1. `make-cert.sh <ip?>` writes a 30-day self-signed cert with SAN `localhost, 127.0.0.1, <LAN ip>` (auto-detected via `ipconfig getifaddr en0` on macOS when not given).
2. `index.ts`: `https.createServer(certs, serveStatic)` if certs else `http`. `new WebSocketServer({ server, path: "/ws", maxPayload: 4096 })`.
3. `serveStatic`: files under `dist` only (reject path traversal with 403), SPA fallback to `index.html`, correct MIME for `.js .css .html .wasm .task .json`, and headers `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` on every response (MediaPipe threads).
4. If `dist` is missing, respond 404 with the build command in the body.
5. On connection: build a `Conn` whose `send` JSON-stringifies when the socket is open; route `message` (text) to `handleMessage`, binary to a malformed call, `close` and `error` to `handleClose`.
6. On listen: print `https://localhost:PORT` and every non-internal IPv4 LAN URL; if no certs, print the cert command and warn that camera only works on localhost.

## Invariants
- One `ServerContext` per process.
- No per-message allocation beyond parse.

## Tests
- Manual: `pnpm --filter @midnight/server cert && pnpm --filter @midnight/server start` prints an https LAN URL; opening it from another device (after building the client in Phase 3) shows the lobby after the certificate warning.

## Done when
- [ ] starts in both modes; typecheck clean
