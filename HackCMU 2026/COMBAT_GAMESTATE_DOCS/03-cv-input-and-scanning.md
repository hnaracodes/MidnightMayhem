> **SUPERSEDED 2026-09-12.** This document is historical. The build follows `DECISIONS_CHANGED.md` (root) and `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md`. Where this file disagrees with them, they win. Kept for reference only.

# Computer Vision Input Contract

## Rollout order

Vision is deliberately not part of the first end-to-end milestone. First prove two browsers can fight using the button/keyboard dispatcher. Then wire pose and scanning into that *same* dispatcher; they may never bypass server validation. The integration owner may disable vision at any time to preserve a reliable demo.

## YOLO scan implementation — exact

Ship `public/models/yolov8n.onnx` and run it through `onnxruntime-web` with WebGPU when `navigator.gpu` exists; otherwise use WASM with `numThreads=1`. Load the model once during pre-match and keep it in memory. Scan frames are a centered 640×640 letterboxed canvas. Execute no more than one inference every 166 ms. Do not run Pose inference while scan mode is active.

Map COCO labels exactly: `"bottle"→bottle`, `"book"→book`, `"backpack"→backpack`, `"cup"→cup`, `"cell phone"→cell phone`; discard all other labels. Convert YOLO output to detections, apply class-aware NMS at IoU 0.45, then choose the highest-confidence allowed detection. A class is confirmed only after the same allowed label wins three consecutive inference results at confidence ≥0.55; reset the streak when a frame has no allowed winner or a different label wins. On confirmation, immediately stop scan mode and send exactly one `SCAN_RESULT` with the server token and rounded confidence to three decimals.

At tick 45, if no confirmation was sent, stop scan mode and show class-choice fallback cards. Selecting a card sends `SCAN_RESULT` with confidence `1`; the server accepts this only when `demoFallbackEnabled=true`. Production mode rejects it.

## Pose recognition thresholds

Use normalized landmarks; never use pixel positions. Calculate shoulder midpoint x, wrist y, and pose visibility. Ignore a frame if either shoulder or wrist visibility is below 0.6. Emit `BLOCK_START` once when both wrists are above their corresponding shoulders for 5 consecutive pose frames; lock it out for 600 ms. Emit dodge once when nose x moves at least 0.18 shoulder-widths from its calibration baseline for 4 consecutive frames; select sign for left/right and lock out for 900 ms. Emit power once when both wrists are above shoulders for 8 consecutive frames while not blocking; lock out for 750 ms. The adapter must reset its counters when disabled or camera tracking is lost.

## Privacy and latency rule

Camera frames, raw landmarks, and object bounding boxes remain local to the browser. Only discrete game intents and confirmed object classes are sent through the native WebSocket.

## Vision modes

```text
POSE mode: 15–20 FPS, used during normal battle.
SCAN mode: 4–8 FPS, used only after accepted Baggage Scan.
```

Initialize both models during loading/pre-match. Execute only one model per camera frame. Do not run full-rate pose and full-rate object detection simultaneously.

## Pose adapter output

The vision module must export this narrow interface:

```ts
type VisionIntent =
  | { type: "BLOCK_START" }
  | { type: "DODGE_LEFT" }
  | { type: "DODGE_RIGHT" }
  | { type: "POWER_USE" };

type PoseAdapter = {
  start(video: HTMLVideoElement): Promise<void>;
  setEnabled(enabled: boolean): void;
  onIntent(listener: (intent: VisionIntent) => void): () => void;
  stop(): void;
};
```

The rest of the game must never import MediaPipe landmark indices directly.

## Gesture rules

Use shoulder width as the normalization scale. Smooth with a light exponential moving average. Each gesture must transition through `NEUTRAL → ARMED → TRIGGERED → COOLDOWN`.

| Intent | Rule | Stability requirement |
|---|---|---|
| Block | both wrists above shoulder line | 150 ms |
| Dodge left | nose is left of shoulder midpoint by 0.25 shoulder widths | 120 ms |
| Dodge right | nose is right of shoulder midpoint by 0.25 shoulder widths | 120 ms |
| Power | both wrists above shoulders | 250 ms |

Gesture cooldowns are local UX guards only. Server action validation remains authoritative.

## Scan adapter output

```ts
type ObjectClass =
  | "BOTTLE"
  | "BOOK"
  | "BACKPACK"
  | "CUP"
  | "CELL_PHONE"
  | "UNKNOWN";

type ScanResult = {
  objectClass: ObjectClass;
  confidence: number;
};
```

The scan adapter must require the same supported class in three consecutive frames with confidence ≥ 0.65. Show the result to the player for explicit confirmation before submitting it.

## Detector-label mapping

Keep detector labels isolated in one map. The game receives only the stable `ObjectClass` values below.

```text
"bottle"     → BOTTLE
"book"       → BOOK
"backpack"   → BACKPACK
"cup"        → CUP
"cell phone" → CELL_PHONE
all else      → UNKNOWN
```

Do not scatter detector-specific labels through the UI or server. A detector swap must change only this map and the scan adapter.

## Required fallbacks

- If camera permission is denied: show keyboard controls and a demo object-class chooser.
- If no pose is visible for 1.5 seconds: retain keyboard controls; do not send stale actions.
- If scan expires: submit nothing and return player to `IDLE`.
- If detector returns an unsupported class: show `MYSTERY PARCEL`; map it to a balanced fixed ability.
- If inference falls below 8 FPS: lower camera resolution and inference cadence before changing game networking.
