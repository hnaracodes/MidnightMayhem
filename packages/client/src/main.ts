import { DEFAULT_LOADOUT, PROTOCOL_VERSION, type LobbyPlayer, type MatchConfig, type PlayerIndex } from "@midnight/shared";
import { PAUSED_BANNER, pausedByVisibility, showBanner } from "./app/banner";
import { CalibrationOverlay } from "./app/calibrationOverlay";
import { CameraPreview, debugFanOut } from "./app/cameraPreview";
import { Landing } from "./app/landing";
import { type CameraButton, Lobby } from "./app/lobby";
import { ResultOverlay } from "./app/result";
import { startGame } from "./game/config";
import { DEFAULT_PLAYER_NAMES, session } from "./game/session";
import { MUTE_KEY, Sfx } from "./game/sfx";
import { KeyboardInputSource } from "./input/KeyboardInputSource";
import { MergedInputSource } from "./input/MergedInputSource";
import { selectSource } from "./input/selectSource";
import { InputSender } from "./net/inputSender";
import { WsClient } from "./net/wsClient";
import { VisionInputError, type VisionErrorCode } from "./vision/errors";
import { VisionInputSource } from "./vision/VisionInputSource";

const client = new WsClient();
// Debug-only RTT probe (the arena overlay shows it); the demo build sends nothing extra.
if (session.debug) client.startPing((rtt) => { session.rtt = rtt; });
const keyboard = new KeyboardInputSource();
const inputSource = new MergedInputSource([keyboard]);
const inputSender = new InputSender(client, inputSource);
session.localSource = inputSource;

const sourceChoice = selectSource();
const CAMERA_MESSAGES: Record<VisionErrorCode, string> = {
  "camera-denied": "Camera permission was denied. Allow the camera for this site and try again. Keyboard still works.",
  "no-camera": "No usable camera was found. Keyboard still works.",
  "model-load": "The pose model failed to load (run vision:setup on this laptop). Keyboard still works.",
  "worker-failed": "The camera tracker crashed before it was ready. Keyboard still works.",
};

/** design/04 § Banners: the 64 px canvas banner and the KO collapse play for 1 s before the DOM result takes over. */
const RESULT_DELAY_MS = 1000;

let connected = false;
let hasSnapshot = false;
let resultTimer: ReturnType<typeof setTimeout> | null = null;
let matchRunning = false;
let lastLobby: { roomId: string; players: (LobbyPlayer | null)[]; config: MatchConfig; host: PlayerIndex } | null = null;

// ---- Camera (Phase 6 rules 1–3) ----
const overlay = new CalibrationOverlay();
const preview = new CameraPreview();
let vision: VisionInputSource | null = null;
let cameraStarting = false;
let autoCameraDone = false;

function cameraButton(): CameraButton {
  if (sourceChoice === "keyboard") return "hidden";
  return cameraStarting ? "starting" : "button";
}

function renderRoom(): void {
  if (!lastLobby || matchRunning) return;
  lobby.renderRoom(
    lastLobby.roomId, lastLobby.players, lastLobby.config, lastLobby.host, session.localIndex,
    session.visionAvailable, cameraButton(),
  );
}

/** The camera counts as on once calibration has begun: camera open, model loaded, worker ready. */
function cameraLive(source: VisionInputSource): void {
  if (vision) return;
  vision = source;
  inputSource.add(source);
  session.visionAvailable = true;
  cameraStarting = false;
  renderRoom();
  // Room screen (rule 6): the player sees themselves before Ready. V toggles it at any time.
  preview.show();
}

async function enableCamera(): Promise<void> {
  if (vision || cameraStarting) return;
  cameraStarting = true;
  showBanner(null);
  renderRoom();

  const source = new VisionInputSource();
  const debug = debugFanOut(source); // onDebug holds one callback; both consumers share it
  overlay.bind(source, debug);
  preview.bind(source, debug);
  overlay.setMode(hasSnapshot ? "compact" : "full");
  overlay.show();
  // start() resolves only when calibration is ready, which needs a person in frame; the camera itself is
  // usable (and Ready must stay reachable) as soon as the phase leaves idle, so poll for that too.
  const live = setInterval(() => {
    if (source.calibrationState().phase === "idle") return;
    clearInterval(live);
    cameraLive(source);
  }, 100);

  try {
    await source.start();
    clearInterval(live);
    cameraLive(source);
  } catch (err) {
    clearInterval(live);
    cameraStarting = false;
    overlay.hide();
    const code = err instanceof VisionInputError ? err.code : "worker-failed";
    console.error("[camera]", err);
    showBanner(CAMERA_MESSAGES[code]);
    renderRoom();
  }
}

// ---- Screens ----
// Landing → Lobby (11.03): the landing owns the join form; the lobby renders from every LOBBY message.
const result = new ResultOverlay(() => client.send({ type: "READY", ready: true }));
const landing = new Landing({
  onEnter: async (name, roomId) => {
    showBanner(null);
    try {
      await client.connect();
      connected = true;
      client.send(roomId
        ? { type: "HELLO", name, roomId }
        : { type: "HELLO", name });
    } catch {
      showBanner("Cannot reach the server");
    }
  },
});
const lobby = new Lobby({
  onReady: (ready) => client.send({ type: "READY", ready }),
  onEnableCamera: () => void enableCamera(),
  onConfig: (config) => client.send({ type: "CONFIG", config }),
  onCustomize: (character, loadout) => client.send({ type: "CUSTOMIZE", character, loadout }),
});

void inputSource.start();
landing.render();
// 4.08 rule 1: the arena boots under the lobby so the roof scrolls behind every overlay from the first frame.
startGame();

// ---- Pause only while the tab is hidden (Phase 6 rule 5) ----
// Window blur must NOT pause: two windows on one laptop blur each other on every click, which froze the
// camera player. The keyboard source already clears its keys on blur, which is all a keyboard player needs.
let pausedBanner = false;
function setPaused(paused: boolean): void {
  if (paused) {
    inputSender.pause();
    showBanner(PAUSED_BANNER);
    pausedBanner = true;
  } else {
    inputSender.resume();
    if (pausedBanner) showBanner(null);
    pausedBanner = false;
  }
}
document.addEventListener("visibilitychange", () => setPaused(pausedByVisibility(document.visibilityState)));

// ---- Sound (11.05): the first user gesture on the page creates the AudioContext; M toggles mute (persisted) ----
session.muted = readMuted();
function unlockAudio(): void {
  if (session.sfx) return;
  let ctx: AudioContext | undefined;
  try {
    const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    ctx = Ctor ? new Ctor() : undefined;
  } catch {
    ctx = undefined;
  }
  const sfx = new Sfx(ctx);
  sfx.setMuted(session.muted);
  session.sfx = sfx;
}
for (const type of ["pointerdown", "keydown", "touchstart"] as const) {
  window.addEventListener(type, unlockAudio, { once: true, passive: true });
}

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

function toggleMute(): void {
  session.muted = !session.muted;
  if (session.sfx) session.sfx.setMuted(session.muted);
  else {
    try { localStorage.setItem(MUTE_KEY, session.muted ? "1" : "0"); } catch { /* private mode */ }
  }
  document.documentElement.dataset["muted"] = String(session.muted);
}

// ---- Testing keys (Phase 6 rule 6): V toggles the camera preview, R dumps the last seconds of vision samples ----
window.addEventListener("keydown", (event) => {
  if (event.repeat || event.target instanceof HTMLInputElement) return;
  if (event.code === "KeyV") preview.toggle();
  if (event.code === "KeyR") dumpVision();
  if (event.code === "KeyM") toggleMute();
});

/** Logs the recorder ring (added by the vision lane as `dump()`; optional so this compiles before it lands). */
function dumpVision(): void {
  const source = vision as (VisionInputSource & { dump?(): unknown[] }) | null;
  const json = JSON.stringify(source?.dump?.() ?? []);
  console.log("[vision dump]", json);
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(json).catch((err: unknown) => console.warn("[vision dump] clipboard", err));
  }
}

// ---- Network ----
client.onStatus = (status) => {
  if (status === "closed" && connected) {
    pausedBanner = false;
    showBanner("Connection lost. Reload to rejoin.");
  }
};

client.on("WELCOME", (message) => {
  session.localIndex = message.playerIndex;
  if (message.protocolVersion !== PROTOCOL_VERSION) {
    showBanner("Client and server versions do not match");
  }
});

client.on("LOBBY", (message) => {
  session.playerNames = message.players.map((p, i) => p?.name || session.playerNames[i] || DEFAULT_PLAYER_NAMES[i] || "");
  session.config = message.config;
  session.roster = message.players.slice(0, message.config.players)
    .map((p) => p ? { character: p.character, loadout: p.loadout } : { character: "drifter", loadout: DEFAULT_LOADOUT });
  lastLobby = { roomId: message.roomId, players: message.players, config: message.config, host: message.host };
  landing.hide();
  renderRoom();
  if (sourceChoice === "vision" && !autoCameraDone) {
    autoCameraDone = true;
    void enableCamera();
  }
});

client.on("ERROR", (message) => showBanner(message.message));
client.on("OPPONENT_LEFT", () => {
  matchRunning = false;
  setMatchBanner(false);
  showBanner("Opponent left the room");
});

client.on("SNAPSHOT", (message) => {
  session.buffer.push(message.state, performance.now());
  session.events.push(...message.events);

  if (!hasSnapshot) {
    hasSnapshot = true;
    inputSender.start();
    overlay.setMode("compact");
  }

  const wasRunning = matchRunning;
  matchRunning = message.state.phase !== "MATCH_END";
  setMatchBanner(matchRunning);
  if (matchRunning) lobby.hide();
  // Rule 6: the preview comes up with every match on a camera player and goes away with the result screen.
  if (matchRunning && !wasRunning && session.visionAvailable) preview.show();
  if (message.state.phase === "COUNTDOWN") {
    result.hide();
    if (resultTimer !== null) { clearTimeout(resultTimer); resultTimer = null; }
  }

  const matchEnd = message.events.find((event) => event.type === "MATCH_END");
  if (matchEnd?.type === "MATCH_END") {
    preview.hide();
    if (resultTimer !== null) clearTimeout(resultTimer);
    resultTimer = setTimeout(() => {
      resultTimer = null;
      result.show(matchEnd.winner, session.buffer.latest(), session.localIndex);
    }, RESULT_DELAY_MS);
  }
});

/** 4.08: during a match the banner strip sits below the HUD bars. */
function setMatchBanner(on: boolean): void {
  document.getElementById("banner")?.classList.toggle("banner--match", on);
}

if (session.debug) {
  (window as unknown as { __mm: unknown }).__mm = {
    session,
    latest: () => session.buffer.latest(),
    sender: inputSender,
    calibration: () => vision?.calibrationState() ?? null,
    preview,
  };
}
