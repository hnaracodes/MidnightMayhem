# 3.03 — Input sources and sender

## Purpose
Keyboard as an `InputSource`, an OR-merge of several sources so keyboard always works next to the webcam, a query-string selector, and the sender that ships the frame to the server on change.

## Files
Create: `packages/client/src/input/KeyboardInputSource.ts`, `MergedInputSource.ts`, `selectSource.ts`, `packages/client/src/net/inputSender.ts`, `test/inputSender.test.ts`, `test/keyboard.test.ts`.

## Depends on
1.01, 3.02.

## Exposes
- `class KeyboardInputSource implements InputSource` — map `KeyA left, KeyD right, KeyW jump, KeyS block, KeyF punchL, KeyG punchR`
- `class MergedInputSource implements InputSource { constructor(sources: InputSource[]) }`
- `selectSource(): "keyboard" | "vision"` from `?input=`; default `keyboard` until Phase 6 flips the default to `vision` when a camera is enabled
- `class InputSender { constructor(client: { send }, source: InputSource, now?: () => number); start(): void; stop(): void; pump(): void }`

## Behaviour
1. Keyboard: `keydown` with `repeat` ignored sets the key true, `keyup` false, `window blur` clears all. `sample()` returns a frozen frame that changes identity only when a key changes.
2. Merged: `sample()` is the logical OR per key across sources; `start` starts all in order, `stop` stops all.
3. Sender: `start` sets a 16.667 ms interval calling `pump`. `pump` samples; if the frame differs from the last sent, or 100 ms have passed since the last send, send `INPUT{seq: ++seq, frame}`. `seq` starts at 1 per page load.
4. The sender never coalesces two changes into one message within a pump; each pump sends at most one.

## Invariants
- `seq` strictly increases; never reused after a reconnect (page reload resets everything).
- Frame payload under 200 bytes.

## Tests
- keyboard: down/up toggles, repeat ignored, blur clears
- sender: first pump sends seq 1; unchanged within 100 ms sends nothing; change sends seq 2; heartbeat at 100 ms

## Done when
- [ ] tests pass
