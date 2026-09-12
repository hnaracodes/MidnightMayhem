/**
 * Every tunable number and colour in the vision layer. One comment each.
 * Values come from `HackCMU 2026/controls/phases/CLAUDE.md` and implementation-docs/05-vision.
 * Distances marked "in S" are divided by the calibrated shoulder width.
 */

// ---- 5.01 camera and model ----
export const CAMERA = { width: 640, height: 480, fps: 30 } as const; // requested capture; actual settings are logged
export const EMA_ALPHA = 0.6; // per-coordinate landmark smoothing; higher = less lag, more jitter
export const MODEL_URL = "/models/pose_landmarker_lite.task"; // served from public/, downloaded by vision:setup (the wasm runtime is imported from the npm package in landmarkers.ts)

// ---- 5.02 calibration ----
export const CALIBRATION_MS = 1500; // consecutive stable frames needed to capture the baseline
export const STABLE_MOVE = 0.02; // max shoulder-midpoint movement (image units) between stable frames
export const RELOST_MS = 1000; // pose absent for longer than this discards the baseline
export const MIN_VIS = 0.5; // landmark visibility below this counts as not seen

// ---- 5.03 walk (lean) ----
export const LEAN_ENTER = 0.25; // |lean| in S to start walking
export const LEAN_EXIT = 0.15; // |lean| in S to stop walking
export const WALK_DEBOUNCE_ON = 3; // consecutive frames before walk turns on
export const WALK_DEBOUNCE_OFF = 3; // consecutive frames before walk turns off

// ---- 5.03 jump (hop) ----
export const JUMP_RISE = 0.12; // hip and shoulder rise in S that counts as airborne
export const JUMP_LAND = 0.05; // rise in S below which the player has landed
export const JUMP_WINDOW_MS = 250; // the rise must have happened within this window
export const JUMP_DEBOUNCE_ON = 1; // frames before jump turns on
export const JUMP_DEBOUNCE_OFF = 2; // frames before jump turns off

// ---- 5.03 block (crossed arms) ----
export const CROSS_MARGIN = 0.1; // each wrist must cross the body midline by this much, in S
export const BLOCK_TOP = 0.1; // wrists may be at most this far above the shoulders, in S
export const BLOCK_WIDTH = 0.8; // wrists must be within this of the midline, in S
export const BLOCK_DEBOUNCE_ON = 3; // frames before block turns on
export const BLOCK_DEBOUNCE_OFF = 3; // frames before block turns off

// ---- 5.03 punch (thrust toward camera, no hand model) ----
// First tuning pass (owner test 2026-09-12: zero punches tracked). World z is MediaPipe's least accurate
// axis, so the depth gates were loosened; the thrust window was widened so a real punch at ~20 fps has
// enough samples; the thrust drop is measured on RAW (unsmoothed) extension so the EMA cannot blunt it.
export const EXT_ENTER = 0.62; // wrist-to-shoulder image distance over arm length that starts a punch (was 0.55: foreshortening at 1.5 m rarely reads below 0.55)
export const EXT_EXIT = 0.75; // extension above which the punch ends
export const DEPTH_ENTER_NO_HAND = 0.22; // wrist ahead of shoulder by this many metres (world z) to start (was 0.40: world z under-reports a 1.5 m thrust by half)
export const DEPTH_EXIT = 0.08; // depth below which the punch ends (was 0.15: keep the exit under the noise floor of the new enter)
export const AT_HEIGHT = 0.6; // wrist must be within this of shoulder height, in S
export const THRUST_DROP = 0.15; // raw extension must have dropped by this much within the thrust window (was 0.25: EMA-lagged samples never showed 0.25 in 200 ms)
export const THRUST_WINDOW_MS = 320; // window for the extension drop (was 200: only 4 samples at 20 fps; 320 gives 6-7)
export const THRUST_ENABLED = true; // require the fast drop; false = depth and extension alone
export const PUNCH_DEBOUNCE_ON = 2; // frames before punch turns on
export const PUNCH_DEBOUNCE_OFF = 3; // frames before punch turns off
export const PUNCH_MIN_HOLD_MS = 100; // once entered, punch stays on at least this long

// ---- 5.03 punch, side-jab entry (integrator amendment; owner decision, flag-gated) ----
// The game is side-view, so players punch sideways, which never changes world depth. `side` is the wrist's
// horizontal offset AWAY from the body past its own shoulder, over arm length (~1 with the arm straight out).
export const SIDE_JAB_ENABLED = true; // allow a fast horizontal jab to count as a punch
export const JAB_RISE = 0.3; // side must have risen by this much within the jab window (measured on raw landmarks)
export const JAB_WINDOW_MS = 250; // window for the side rise
export const JAB_EXT = 0.9; // side above which the arm counts as straight out
export const JAB_EXIT = JAB_EXT - 0.15; // side below which a jab-entered punch ends

// ---- 5.04 recorder (integrator amendment) ----
export const RECORDER_SECONDS = 15; // seconds of { ts, metrics, gestures, frame, punch } samples kept for dump()

// ---- overlay colours (harness and calibration overlay) ----
export const COLOR_POSE = "#4FE3F5"; // skeleton lines and joints, cyan
export const COLOR_MARKER = "#E8434F"; // thresholds and active-gesture markers, red
export const COLOR_LABEL = "#FFFFFF"; // text labels, white
