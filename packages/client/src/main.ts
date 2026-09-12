import { PROTOCOL_VERSION, type LobbyPlayer } from "@midnight/shared";
import { showBanner } from "./app/banner";
import { CalibrationOverlay } from "./app/calibrationOverlay";
import { type CameraButton, Lobby } from "./app/lobby";
import { ResultOverlay } from "./app/result";
import { startGame } from "./game/config";
import { session } from "./game/session";
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
const PAUSED_BANNER = "Paused — click to resume";
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
let lastLobby: { roomId: string; players: [LobbyPlayer | null, LobbyPlayer | null] } | null = null;

// ---- Camera (Phase 6 rules 1–3) ----
const overlay = new CalibrationOverlay();
let vision: VisionInputSource | null = null;
let cameraStarting = false;
let autoCameraDone = false;

function cameraButton(): CameraButton {
  if (sourceChoice === "keyboard") return "hidden";
  return cameraStarting ? "starting" : "button";
}

function renderRoom(): void {
  if (!lastLobby || matchRunning) return;
  lobby.renderRoom(lastLobby.roomId, lastLobby.players, session.visionAvailable, cameraButton());
}

/** The camera counts as on once calibration has begun: camera open, model loaded, worker ready. */
function cameraLive(source: VisionInputSource): void {
  if (vision) return;
  vision = source;
  inputSource.add(source);
  session.visionAvailable = true;
  cameraStarting = false;
  renderRoom();
}

async function enableCamera(): Promise<void> {
  if (vision || cameraStarting) return;
  cameraStarting = true;
  showBanner(null);
  renderRoom();

  const source = new VisionInputSource();
  overlay.bind(source);
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
const result = new ResultOverlay(() => client.send({ type: "READY", ready: true }));
const lobby = new Lobby({
  onJoin: async (name, roomId) => {
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
  onReady: (ready) => client.send({ type: "READY", ready }),
  onEnableCamera: () => void enableCamera(),
});

void inputSource.start();
lobby.renderJoin();
// 4.08 rule 1: the arena boots under the lobby so the roof scrolls behind every overlay from the first frame.
startGame();

// ---- Pause on blur / hidden (Phase 6 rule 5) ----
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
window.addEventListener("blur", () => setPaused(true));
window.addEventListener("focus", () => setPaused(false));
document.addEventListener("visibilitychange", () => setPaused(document.visibilityState === "hidden"));

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
  session.playerNames = [
    message.players[0]?.name || session.playerNames[0],
    message.players[1]?.name || session.playerNames[1],
  ];
  lastLobby = { roomId: message.roomId, players: message.players };
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

  matchRunning = message.state.phase !== "MATCH_END";
  setMatchBanner(matchRunning);
  if (matchRunning) lobby.hide();
  if (message.state.phase === "COUNTDOWN") {
    result.hide();
    if (resultTimer !== null) { clearTimeout(resultTimer); resultTimer = null; }
  }

  const matchEnd = message.events.find((event) => event.type === "MATCH_END");
  if (matchEnd?.type === "MATCH_END") {
    if (resultTimer !== null) clearTimeout(resultTimer);
    resultTimer = setTimeout(() => {
      resultTimer = null;
      result.show(matchEnd.winner, session.localIndex);
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
  };
}
