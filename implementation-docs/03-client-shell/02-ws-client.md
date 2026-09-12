# 3.02 — Socket client

## Purpose
Typed wrapper over the browser `WebSocket`: connect, send `ClientMessage`, subscribe per `ServerMessage` type, expose status.

## Files
Create: `packages/client/src/net/wsClient.ts`.

## Depends on
1.05.

## Exposes
- `type Status = "idle" | "connecting" | "open" | "closed"`
- `defaultUrl(): string` — `wss:` or `ws:` matching `location.protocol`, same host, `/ws`
- `class WsClient { status; onStatus: (s) => void; connect(url?): Promise<void>; send(m: ClientMessage): void; on<T>(type: T, handler): () => void }`

- `startPing(onRtt: (rttMs) => void, now?: () => number): () => void` — debug RTT probe: sends `PING{t: now()}` on open and every `PING_INTERVAL_MS` (2000) while open, reports `smoothRtt(prev, now() - t)` on each `PONG`; returns a stop function. Started only by `main.ts` under `?debug=1`. (polish amendment)
- `smoothRtt(prev: number | null, sampleMs: number): number` — pure EMA over `RTT_EMA_WINDOW` (4) samples, seeded by the first (polish amendment)

## Behaviour
1. `connect` resolves on `open`, rejects on `error` before open.
2. `send` is a no-op unless the socket is open.
3. `on` returns an unsubscribe function; multiple handlers per type allowed.
4. Incoming frames are `JSON.parse`d and dispatched by `type`; a parse failure is logged and ignored.
5. No automatic reconnect in the MVP; `closed` status is surfaced to the app, which shows a banner.

## Invariants
- Only one socket per `WsClient`.

## Tests
- Unit test with a fake `WebSocket` global: dispatch by type, unsubscribe works, send ignored when not open.

## Done when
- [ ] test passes
