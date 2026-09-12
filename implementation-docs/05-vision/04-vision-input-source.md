# 5.04 — Classify and VisionInputSource

## Purpose
Combine gestures with the priority rule into a frozen `InputFrame`, and expose the whole layer as one `InputSource` plus a calibration state the host renders.

## Files
Create: `packages/client/src/vision/classify.ts`, `VisionInputSource.ts`, `test/classify.test.ts`.

## Depends on
5.01–5.03.

## Exposes
- `classify(g: { left, right, jump, punchL, punchR, block }): Readonly<InputFrame>` — returns a frozen object reused until a field changes
- `class VisionInputSource implements InputSource { start(): Promise<void>; stop(): void; sample(): Readonly<InputFrame>; calibrate(): Promise<void>; calibrationState(): { phase, progress }; stats(): { fps, poseMs, dropped, delegate }; onDebug(cb: (frame: DebugFrame) => void) }`
- `interface DebugFrame { landmarks; metrics; gestures; frame; ts }` for the harness and the calibration preview

## Behaviour
1. Priority: if `jump` then `block = punchL = punchR = false`; else if `block` then `punchL = punchR = false`. `left`/`right` independent.
2. `start`: open camera, start worker and wait for `ready`, then `calibrate()`; resolves when calibration is `ready`. Rejects with `VisionInputError`.
3. `sample` returns `EMPTY_FRAME` unless calibration phase is `ready`; never awaits, never allocates.
4. `stop`: stops the frame loop, releases camera tracks, terminates the worker.
5. The class touches no DOM except the hidden `<video>` it owns; the host renders prompts from `calibrationState()`.
6. Per result: EMA → calibration.update → if ready: metrics → gestures → classify → store frame; emit `DebugFrame`.

## Invariants
- `sample()` cost is a property read.
- No landmark ever leaves this module except through `onDebug`.

## Tests
- classify priority table (jump beats block beats punches; walk passes through).
- Manual: harness consumes the layer only through this class.

## Done when
- [ ] tests pass; harness uses `VisionInputSource` exclusively
