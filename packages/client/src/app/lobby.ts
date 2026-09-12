import type { LobbyPlayer } from "@midnight/shared";

interface LobbyHandlers {
  onJoin(name: string, roomId?: string): void;
  onReady(ready: boolean): void;
  onEnableCamera(): void;
}

const NAME_STORAGE_KEY = "midnight-mayhem:name";

export class Lobby {
  private readonly root: HTMLElement;
  private ready = false;

  constructor(private readonly handlers: LobbyHandlers) {
    this.root = requiredElement("lobby");
  }

  renderJoin(): void {
    this.root.replaceChildren();
    this.root.hidden = false;

    const title = document.createElement("h1");
    title.textContent = "MIDNIGHT MAYHEM";
    const name = input("Player name", localStorage.getItem(NAME_STORAGE_KEY) ?? "");
    name.maxLength = 16;
    const room = input("Room code (blank creates one)");
    room.maxLength = 8;
    room.addEventListener("input", () => {
      room.value = room.value.toUpperCase();
    });
    const join = button("Join");
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

    this.root.append(title, name, room, join, legend);
  }

  renderRoom(
    roomId: string,
    players: [LobbyPlayer | null, LobbyPlayer | null],
    visionAvailable: boolean,
  ): void {
    this.root.replaceChildren();
    this.root.hidden = false;

    const heading = document.createElement("h1");
    heading.textContent = roomId;
    heading.setAttribute("aria-label", `Room ${roomId}`);

    const roster = document.createElement("div");
    roster.className = "roster";
    roster.append(
      playerRow("THE DRIFTER", players[0]),
      playerRow("THE CONDUCTOR", players[1]),
    );

    const camera = button(visionAvailable ? "Camera on" : "Enable camera");
    camera.disabled = visionAvailable;
    camera.addEventListener("click", () => this.handlers.onEnableCamera());

    const ready = button(this.ready ? "Not ready" : "Ready");
    ready.setAttribute("aria-pressed", String(this.ready));
    ready.addEventListener("click", () => {
      this.ready = !this.ready;
      ready.textContent = this.ready ? "Not ready" : "Ready";
      ready.setAttribute("aria-pressed", String(this.ready));
      this.handlers.onReady(this.ready);
    });

    this.root.append(heading, roster, camera, ready);
  }

  hide(): void {
    this.root.hidden = true;
  }
}

function playerRow(character: string, player: LobbyPlayer | null): HTMLElement {
  const row = document.createElement("section");
  const title = document.createElement("h2");
  title.textContent = character;
  const status = document.createElement("p");
  status.textContent = player
    ? `${player.name} · ${player.ready ? "ready" : "not ready"}`
    : "waiting";
  row.append(title, status);
  return row;
}

function input(placeholder: string, value = ""): HTMLInputElement {
  const element = document.createElement("input");
  element.placeholder = placeholder;
  element.value = value;
  return element;
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  return element;
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}
