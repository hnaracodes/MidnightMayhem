import { PROTOCOL_VERSION } from "@midnight/shared";
import { showBanner } from "./app/banner";
import { Lobby } from "./app/lobby";
import { ResultOverlay } from "./app/result";
import { startGame } from "./game/config";
import { session } from "./game/session";
import { KeyboardInputSource } from "./input/KeyboardInputSource";
import { MergedInputSource } from "./input/MergedInputSource";
import { InputSender } from "./net/inputSender";
import { WsClient } from "./net/wsClient";

const client = new WsClient();
const keyboard = new KeyboardInputSource();
const inputSource = new MergedInputSource([keyboard]);
const inputSender = new InputSender(client, inputSource);
session.localSource = inputSource;

let connected = false;
let hasSnapshot = false;
let matchRunning = false;

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
  onEnableCamera: () => showBanner("Camera unavailable"),
});

void inputSource.start();
lobby.renderJoin();

client.onStatus = (status) => {
  if (status === "closed" && connected) {
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
  if (!matchRunning) {
    lobby.renderRoom(message.roomId, message.players, session.visionAvailable);
  }
});

client.on("ERROR", (message) => showBanner(message.message));
client.on("OPPONENT_LEFT", () => {
  matchRunning = false;
  showBanner("Opponent left the room");
});

client.on("SNAPSHOT", (message) => {
  session.buffer.push(message.state, performance.now());
  session.events.push(...message.events);

  if (!hasSnapshot) {
    hasSnapshot = true;
    startGame();
    inputSender.start();
  }

  matchRunning = message.state.phase !== "MATCH_END";
  if (matchRunning) lobby.hide();
  if (message.state.phase === "COUNTDOWN") result.hide();

  const matchEnd = message.events.find((event) => event.type === "MATCH_END");
  if (matchEnd?.type === "MATCH_END") {
    result.show(matchEnd.winner, session.localIndex);
  }
});
