import { CHARACTER_LABEL, type LobbyPlayer, type PlayerIndex } from "@midnight/shared";

interface LobbyHandlers {
  onJoin(name: string, roomId?: string): void;
  onReady(ready: boolean): void;
  onEnableCamera(): void;
}

/**
 * Camera button (Phase 6 rule 1 and 3): `button` offers "Enable camera"; `starting` disables it while the
 * camera opens; `hidden` omits it (`?input=keyboard`). "Camera on" (disabled) wins whenever `visionAvailable`.
 */
export type CameraButton = "button" | "starting" | "hidden";

const NAME_STORAGE_KEY = "midnight-mayhem:name";
const SUBTITLE = "on the roof of the Midnight Express";

export class Lobby {
  private readonly root: HTMLElement;
  private ready = false;

  constructor(private readonly handlers: LobbyHandlers) {
    this.root = requiredElement("lobby");
  }

  renderJoin(): void {
    this.root.replaceChildren();
    this.root.hidden = false;

    const name = input("Player name", localStorage.getItem(NAME_STORAGE_KEY) ?? "");
    name.maxLength = 16;
    const room = input("Room code (blank creates one)");
    room.maxLength = 8;
    room.autocapitalize = "characters";
    room.addEventListener("input", () => {
      room.value = room.value.toUpperCase();
    });
    const join = button("Join", true);
    const legend = document.createElement("p");
    legend.textContent = "A/D walk · W jump · S block · F/G punch";

    const submit = (): void => {
      const playerName = name.value.trim();
      if (!playerName) {
        name.focus();
        return;
      }
      localStorage.setItem(NAME_STORAGE_KEY, playerName);
      const roomId = room.value.trim().toUpperCase();
      this.handlers.onJoin(playerName, roomId || undefined);
    };
    join.addEventListener("click", submit);
    room.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });

    this.root.append(title(), name, room, join, legend);
  }

  renderRoom(
    roomId: string,
    players: (LobbyPlayer | null)[],
    visionAvailable: boolean,
    cameraButton: CameraButton = "button",
  ): void {
    this.root.replaceChildren();
    this.root.hidden = false;

    const code = document.createElement("h2");
    code.className = "room-code";
    code.textContent = roomId;
    code.setAttribute("aria-label", `Room ${roomId}`);

    const roster = document.createElement("div");
    roster.className = "roster";
    // Every slot the server sent (four after 08-contracts); the real lobby with picks and host controls is 11.03.
    roster.append(...players.map((player, index) => playerRow(index as PlayerIndex, player)));

    const camera = button(
      visionAvailable ? "Camera on" : cameraButton === "starting" ? "Starting camera…" : "Enable camera",
    );
    camera.disabled = visionAvailable || cameraButton === "starting";
    camera.addEventListener("click", () => this.handlers.onEnableCamera());

    const ready = button(this.ready ? "Not ready" : "Ready", true);
    ready.setAttribute("aria-pressed", String(this.ready));
    ready.addEventListener("click", () => {
      this.ready = !this.ready;
      ready.textContent = this.ready ? "Not ready" : "Ready";
      ready.setAttribute("aria-pressed", String(this.ready));
      this.handlers.onReady(this.ready);
    });

    const actions = document.createElement("div");
    actions.className = "actions";
    if (cameraButton !== "hidden") actions.append(camera);
    actions.append(ready);

    this.root.append(title(), code, roster, actions);
  }

  hide(): void {
    this.root.hidden = true;
  }
}

function title(): HTMLElement {
  const heading = document.createElement("h1");
  heading.className = "title";
  heading.textContent = "MIDNIGHT MAYHEM";
  const subtitle = document.createElement("small");
  subtitle.textContent = SUBTITLE;
  heading.append(subtitle);
  return heading;
}

function playerRow(index: PlayerIndex, player: LobbyPlayer | null): HTMLElement {
  const slug = player?.character ?? (index === 0 ? "drifter" : "conductor");
  const character = { slug, label: CHARACTER_LABEL[slug] };
  const row = document.createElement("section");
  row.className = "player-row";
  row.dataset["character"] = character.slug;
  row.dataset["ready"] = String(player?.ready ?? false);
  const text = document.createElement("div");
  const heading = document.createElement("h2");
  heading.textContent = character.label;
  const status = document.createElement("p");
  status.textContent = player
    ? `${player.name} · ${player.ready ? "ready" : "not ready"}`
    : "waiting";
  text.append(heading, status);
  row.append(text);
  return row;
}

function input(placeholder: string, value = ""): HTMLInputElement {
  const element = document.createElement("input");
  element.placeholder = placeholder;
  element.value = value;
  return element;
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
