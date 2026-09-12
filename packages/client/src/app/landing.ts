import { CHARACTERS } from "@midnight/shared";
import { session } from "../game/session";

interface LandingHandlers {
  onEnter(name: string, roomId?: string): void;
}

const NAME_STORAGE_KEY = "midnight-mayhem:name";
const INVITATION = "Four of you, one roof, no brakes.";
/** Every key, in the order the hands learn them (behaviour 7). */
export const KEY_LEGEND: readonly [string, string][] = [
  ["A/D", "walk"], ["W", "jump"], ["S", "block"], ["F/G", "punch"],
  ["Q", "laser"], ["1–5", "items"], ["V", "preview"], ["M", "mute"],
];

/**
 * The landing page: the live stage runs behind it with the four characters idling in attract mode
 * (`session.attract`, read by the arena), the title, one invitation line and the boarding ticket.
 */
export class Landing {
  private readonly root: HTMLElement;

  constructor(private readonly handlers: LandingHandlers) {
    const root = document.getElementById("landing");
    if (!root) throw new Error("Missing #landing");
    this.root = root;
  }

  render(): void {
    session.attract = CHARACTERS;
    session.reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.root.replaceChildren();
    this.root.hidden = false;

    const heading = document.createElement("h1");
    heading.className = "title";
    heading.textContent = "MIDNIGHT MAYHEM";
    const invitation = document.createElement("p");
    invitation.className = "invitation";
    invitation.textContent = INVITATION;

    const ticket = document.createElement("form");
    ticket.className = "ticket";
    ticket.noValidate = true;
    const name = field("name", "Your name", storedName(), 16);
    name.input.autocomplete = "off";
    const room = field("room", "Room code", "", 8);
    room.input.placeholder = "new room";
    room.input.autocapitalize = "characters";
    room.input.addEventListener("input", () => { room.input.value = room.input.value.toUpperCase(); });
    const enter = document.createElement("button");
    enter.type = "button";
    enter.className = "btn btn-primary";
    enter.textContent = "Board the train";
    ticket.append(name.label, room.label, enter);

    const submit = (event?: Event): void => {
      event?.preventDefault();
      const playerName = name.input.value.trim();
      if (!playerName) {
        name.input.focus();
        name.label.classList.add("missing");
        return;
      }
      try { localStorage.setItem(NAME_STORAGE_KEY, playerName); } catch { /* private mode */ }
      const roomId = room.input.value.trim().toUpperCase();
      this.handlers.onEnter(playerName, roomId || undefined);
    };
    ticket.addEventListener("submit", submit);
    enter.addEventListener("click", submit);
    for (const input of [name.input, room.input]) {
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(event); });
    }

    const legend = document.createElement("dl");
    legend.className = "legend";
    for (const [key, verb] of KEY_LEGEND) {
      const pair = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = verb;
      pair.append(dt, dd);
      legend.append(pair);
    }

    this.root.append(heading, invitation, ticket, legend);
    if (!name.input.value) name.input.focus();
  }

  hide(): void {
    session.attract = null;
    this.root.hidden = true;
  }
}

function storedName(): string {
  try { return localStorage.getItem(NAME_STORAGE_KEY) ?? ""; } catch { return ""; }
}

function field(name: string, text: string, value: string, maxLength: number): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  label.className = "field";
  const caption = document.createElement("span");
  caption.textContent = text;
  const input = document.createElement("input");
  input.name = name;
  input.value = value;
  input.maxLength = maxLength;
  input.spellcheck = false;
  label.append(caption, input);
  return { label, input };
}
