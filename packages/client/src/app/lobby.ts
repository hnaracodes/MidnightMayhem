import {
  CHARACTER_LABEL, DEFAULT_LOADOUT, ITEMS, TEAM_OF,
  type CharacterId, type LobbyPlayer, type Loadout, type MatchConfig, type PlayerIndex,
} from "@midnight/shared";
import { Customize, HostControls, describeConfig } from "./setup";
import { portrait } from "./sprites/portrait";

interface LobbyHandlers {
  onReady(ready: boolean): void;
  onEnableCamera(): void;
  onConfig(config: MatchConfig): void;
  onCustomize(character: CharacterId, loadout: Loadout): void;
}

/**
 * Camera button (Phase 6 rule 1 and 3): `button` offers "Enable camera"; `starting` disables it while the
 * camera opens; `hidden` omits it (`?input=keyboard`). "Camera on" (disabled) wins whenever `visionAvailable`.
 */
export type CameraButton = "button" | "starting" | "hidden";

/** Short glyph per item for the seat row. */
const ITEM_GLYPH: Record<keyof typeof ITEMS, string> = {
  molotov: "bottle", sword: "umbrella", shield: "backpack", banana: "banana", flash: "phone",
};

/**
 * The carriage manifest: room code, one seat per configured player, the route board (live for the host,
 * read-only with a sentence for guests), your seat (character and two items), the camera button and Ready.
 */
export class Lobby {
  private readonly root: HTMLElement;
  private readonly hostControls: HostControls;
  private readonly customize: Customize;

  constructor(private readonly handlers: LobbyHandlers) {
    this.root = requiredElement("lobby");
    this.hostControls = new HostControls((config) => this.handlers.onConfig(config));
    this.customize = new Customize((character, loadout) => this.handlers.onCustomize(character, loadout));
  }

  renderRoom(
    roomId: string,
    players: (LobbyPlayer | null)[],
    config: MatchConfig,
    host: PlayerIndex,
    localIndex: PlayerIndex,
    visionAvailable: boolean,
    cameraButton: CameraButton = "button",
  ): void {
    // Every LOBBY rebuilds the DOM; remember which control had the keyboard focus so it comes back (rule 9).
    const focused = focusKey(document.activeElement);
    this.root.replaceChildren();
    this.root.hidden = false;
    const seated = players.slice(0, config.players).filter((p): p is LobbyPlayer => p !== null);
    const local = players[localIndex] ?? null;
    const isHost = host === localIndex;

    // Left column: the manifest.
    const manifest = document.createElement("section");
    manifest.className = "manifest";
    const code = document.createElement("h1");
    code.className = "room-code";
    code.innerHTML = "";
    const codeLabel = document.createElement("span");
    codeLabel.textContent = "Room";
    const codeValue = document.createElement("strong");
    codeValue.textContent = roomId;
    code.append(codeLabel, codeValue);
    code.setAttribute("aria-label", `Room ${roomId}`);

    const seats = document.createElement("ol");
    seats.className = "seats";
    for (let i = 0; i < config.players; i++) {
      seats.append(seat(i as PlayerIndex, players[i] ?? null, config, host, localIndex));
    }

    const missing = Math.max(0, config.players - seated.length);
    const ready = button(missing > 0 ? `Waiting for ${missing} more` : local?.ready ? "Not ready" : "Ready", true);
    ready.disabled = missing > 0;
    ready.setAttribute("aria-pressed", String(local?.ready ?? false));
    ready.addEventListener("click", () => this.handlers.onReady(!(local?.ready ?? false)));

    const camera = button(
      visionAvailable ? "Camera on" : cameraButton === "starting" ? "Starting camera…" : "Enable camera",
    );
    camera.disabled = visionAvailable || cameraButton === "starting";
    camera.addEventListener("click", () => this.handlers.onEnableCamera());

    const actions = document.createElement("div");
    actions.className = "actions";
    if (cameraButton !== "hidden") actions.append(camera);
    actions.append(ready);
    manifest.append(code, seats, actions);

    // Right column: the route board, then your seat.
    const board = document.createElement("section");
    board.className = "board";
    const routeHead = document.createElement("h2");
    routeHead.textContent = isHost ? "Route" : "Route, set by the host";
    const route = document.createElement("div");
    // The server refuses a player count below the highest seated slot + 1 (10.03), so those are disabled.
    const highestSeated = players.reduce((top, p, i) => (p !== null ? i : top), -1);
    this.hostControls.render(route, config, isHost, Math.max(2, highestSeated + 1));
    const summary = document.createElement("p");
    summary.className = "route-summary";
    summary.textContent = describeConfig(config);
    const seatHead = document.createElement("h2");
    seatHead.textContent = "Your seat";
    const pick = document.createElement("div");
    const taken = players
      .filter((p, i): p is LobbyPlayer => p !== null && i !== localIndex && i < config.players)
      .map((p) => p.character);
    this.customize.render(pick, {
      character: local?.character ?? "drifter",
      loadout: local?.loadout ?? DEFAULT_LOADOUT,
    }, taken);
    board.append(routeHead, route, summary, seatHead, pick);

    this.root.append(manifest, board);
    if (focused) this.root.querySelector<HTMLElement>(focused)?.focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
  }
}

/** A selector that finds the same control again after a re-render, or null when nothing in the lobby is focused. */
export function focusKey(el: Element | null): string | null {
  if (!(el instanceof HTMLElement) || !el.closest("#lobby")) return null;
  const { field, value, character, item } = { ...el.closest<HTMLElement>("[data-field]")?.dataset, ...el.dataset };
  if (field !== undefined && value !== undefined) return `[data-field="${field}"] button[data-value="${value}"]`;
  if (character !== undefined) return `button[data-character="${character}"]`;
  if (item !== undefined) return `button[data-item="${item}"]`;
  if (el.classList.contains("btn-primary")) return "button.btn-primary";
  if (el.classList.contains("btn")) return ".actions button.btn:not(.btn-primary)";
  return null;
}

function seat(index: PlayerIndex, player: LobbyPlayer | null, config: MatchConfig, host: PlayerIndex, localIndex: PlayerIndex): HTMLElement {
  const row = document.createElement("li");
  row.className = "seat";
  row.dataset["ready"] = String(player?.ready ?? false);
  if (player && host === index) row.dataset["host"] = "true";
  if (index === localIndex) row.dataset["you"] = "true";
  if (config.teams === "2v2") row.dataset["team"] = String(TEAM_OF["2v2"](index, config.players));
  if (!player) {
    row.dataset["empty"] = "true";
    const text = document.createElement("p");
    text.className = "seat-empty";
    text.textContent = `Empty seat, share the room code`;
    row.append(text);
    return row;
  }
  row.dataset["character"] = player.character;
  const text = document.createElement("div");
  text.className = "seat-text";
  const name = document.createElement("h3");
  name.textContent = player.name;
  if (host === index) {
    const mark = document.createElement("small");
    mark.className = "seat-host";
    mark.textContent = "host";
    name.append(mark);
  }
  if (config.teams === "2v2") {
    const team = document.createElement("small");
    team.className = "seat-team";
    team.textContent = TEAM_OF["2v2"](index, config.players) === 0 ? "team A" : "team B";
    name.append(team);
  }
  const character = document.createElement("p");
  character.className = "seat-character";
  character.textContent = CHARACTER_LABEL[player.character];
  const loadout = document.createElement("p");
  loadout.className = "seat-loadout";
  loadout.textContent = player.loadout.map((id) => ITEM_GLYPH[id]).join(" + ");
  text.append(name, character, loadout);
  const mark = document.createElement("span");
  mark.className = "seat-ready";
  mark.setAttribute("aria-label", player.ready ? "ready" : "not ready");
  mark.textContent = player.ready ? "ready" : "";
  row.append(portrait(player.character), text, mark);
  return row;
}

function button(label: string, primary = false): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = primary ? "btn btn-primary" : "btn";
  element.textContent = label;
  return element;
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}
