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
export const EXT_ENTER = 0.55; // wrist-to-shoulder image distance over arm length that starts a punch
export const EXT_EXIT = 0.75; // extension above which the punch ends
export const DEPTH_ENTER_NO_HAND = 0.4; // wrist ahead of shoulder by this many metres (world z) to start
export const DEPTH_EXIT = 0.15; // depth below which the punch ends
export const AT_HEIGHT = 0.6; // wrist must be within this of shoulder height, in S
export const THRUST_DROP = 0.25; // extension must have dropped by this much within the thrust window
export const THRUST_WINDOW_MS = 200; // window for the extension drop
export const THRUST_ENABLED = true; // require the fast drop; false = depth and extension alone
export const PUNCH_DEBOUNCE_ON = 2; // frames before punch turns on
export const PUNCH_DEBOUNCE_OFF = 3; // frames before punch turns off
export const PUNCH_MIN_HOLD_MS = 100; // once entered, punch stays on at least this long

// ---- overlay colours (harness and calibration overlay) ----
export const COLOR_POSE = "#4FE3F5"; // skeleton lines and joints, cyan
export const COLOR_MARKER = "#E8434F"; // thresholds and active-gesture markers, red
export const COLOR_LABEL = "#FFFFFF"; // text labels, white
