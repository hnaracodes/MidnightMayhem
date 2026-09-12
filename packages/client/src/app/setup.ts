import {
  CHARACTERS, CHARACTER_LABEL, ITEMS, ITEM_IDS, MAPS, MAP_IDS, MODES, MODE_IDS, TEAMS_IDS, normalizeConfig,
  type CharacterId, type ItemId, type Loadout, type MapId, type MatchConfig, type ModeId, type RosterEntry, type TeamsId,
} from "@midnight/shared";
import { portrait } from "./sprites/portrait";

/** The host's bursts of clicks collapse into one CONFIG (behaviour 3). */
export const CONFIG_DEBOUNCE_MS = 150;

const PLAYER_COUNTS = [2, 3, 4] as const;
const TEAMS_LABEL: Record<TeamsId, string> = { ffa: "free-for-all", "2v2": "2v2" };
/** What each item is in the real world (behaviour: the loadout tile names the object to bring). */
const BRING: Record<ItemId, string> = {
  molotov: "bring a water bottle",
  sword: "bring a tennis racket",
  shield: "bring a backpack",
  banana: "bring a banana",
  flash: "bring a phone",
};

type Field = "players" | "teams" | "mode" | "map" | "items";
interface Row { field: Field; label: string; options: { value: string; label: string }[] }
const ROWS: Row[] = [
  { field: "players", label: "Players", options: PLAYER_COUNTS.map((n) => ({ value: String(n), label: String(n) })) },
  { field: "teams", label: "Teams", options: TEAMS_IDS.map((t) => ({ value: t, label: TEAMS_LABEL[t] })) },
  { field: "mode", label: "Mode", options: MODE_IDS.map((m) => ({ value: m, label: MODES[m].label.toLowerCase() })) },
  { field: "map", label: "Map", options: MAP_IDS.map((m) => ({ value: m, label: MAPS[m].label.toLowerCase() })) },
  { field: "items", label: "Items", options: [{ value: "true", label: "on" }, { value: "false", label: "off" }] },
];

function valueOf(config: MatchConfig, field: Field): string {
  return String(config[field]);
}

function withField(config: MatchConfig, field: Field, value: string): MatchConfig {
  switch (field) {
    case "players": return normalizeConfig({ ...config, players: Number(value) as 2 | 3 | 4 });
    case "teams": return normalizeConfig({ ...config, teams: value as TeamsId });
    case "mode": return normalizeConfig({ ...config, mode: value as ModeId });
    case "map": return normalizeConfig({ ...config, map: value as MapId });
    case "items": return normalizeConfig({ ...config, items: value === "true" });
  }
}

/**
 * The route board: players, teams (only with four), mode, map, items. The host's clicks re-render at once and
 * emit one normalised config after the debounce; guests see the same board with every segment disabled.
 */
export class HostControls {
  private config: MatchConfig | null = null;
  private root: HTMLElement | null = null;
  private enabled = false;
  private minPlayers = 2;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onChange: (config: MatchConfig) => void) {}

  /**
   * `minPlayers` is the lowest player count the server would accept (one past the highest seated slot), so
   * the counts below it are drawn disabled instead of being picked and then rejected with no LOBBY to undo it.
   */
  render(root: HTMLElement, config: MatchConfig, enabled: boolean, minPlayers = 2): void {
    this.root = root;
    this.minPlayers = minPlayers;
    // A LOBBY that lands inside the debounce window still carries the pre-click config; the host's pending
    // pick wins until it has been sent, then the next LOBBY is the truth again.
    if (this.timer === null || !enabled) this.config = normalizeConfig(config);
    this.enabled = enabled;
    this.draw();
  }

  private draw(): void {
    const { root, config } = this;
    if (!root || !config) return;
    root.replaceChildren();
    root.classList.add("route");
    for (const row of ROWS) {
      const line = document.createElement("div");
      line.className = "route-row";
      line.dataset["field"] = row.field;
      const label = document.createElement("span");
      label.className = "route-label";
      label.textContent = row.label;
      const group = document.createElement("div");
      group.className = "segments";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", row.label);
      const rowDisabled = !this.enabled || (row.field === "teams" && config.players !== 4);
      for (const option of row.options) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "segment";
        button.dataset["value"] = option.value;
        button.textContent = option.label;
        button.disabled = rowDisabled || (row.field === "players" && Number(option.value) < this.minPlayers);
        button.setAttribute("aria-pressed", String(valueOf(config, row.field) === option.value));
        button.addEventListener("click", () => this.pick(row.field, option.value));
        group.append(button);
      }
      line.append(label, group);
      root.append(line);
    }
  }

  private pick(field: Field, value: string): void {
    if (!this.enabled || !this.config) return;
    this.config = withField(this.config, field, value);
    this.draw();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.config) this.onChange(this.config);
    }, CONFIG_DEBOUNCE_MS);
  }
}

/**
 * Your seat: four portraits (duplicates allowed; a character another player holds gets an "also P2" tag) and
 * five item tiles of which exactly two are chosen. A new pick replaces the older of the two and emits at once.
 */
export class Customize {
  private current: RosterEntry | null = null;

  constructor(private readonly onChange: (character: CharacterId, loadout: Loadout) => void) {}

  render(root: HTMLElement, current: RosterEntry, taken: CharacterId[]): void {
    this.current = { character: current.character, loadout: [...current.loadout] as Loadout };
    root.replaceChildren();
    root.classList.add("seat-pick");

    const heads = document.createElement("div");
    heads.className = "portraits";
    heads.setAttribute("role", "group");
    heads.setAttribute("aria-label", "Character");
    for (const id of CHARACTERS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "portrait";
      button.dataset["character"] = id;
      button.setAttribute("aria-pressed", String(id === current.character));
      const name = document.createElement("span");
      name.className = "portrait-name";
      name.textContent = CHARACTER_LABEL[id];
      button.append(portrait(id), name);
      const others = taken.filter((t) => t === id).length;
      if (others > 0) {
        const tag = document.createElement("small");
        tag.className = "portrait-tag";
        tag.textContent = others === 1 ? "also picked" : `also picked ×${others}`;
        button.append(tag);
      }
      button.addEventListener("click", () => {
        if (!this.current || this.current.character === id) return;
        this.current.character = id;
        for (const b of heads.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset["character"] === id));
        this.onChange(id, this.current.loadout);
      });
      heads.append(button);
    }

    const items = document.createElement("div");
    items.className = "items";
    items.setAttribute("role", "group");
    items.setAttribute("aria-label", "Two items");
    for (const id of ITEM_IDS) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "item";
      tile.dataset["item"] = id;
      tile.setAttribute("aria-pressed", String(current.loadout.includes(id)));
      const name = document.createElement("span");
      name.className = "item-name";
      name.textContent = ITEMS[id].label;
      const pips = document.createElement("span");
      pips.className = "pips";
      pips.setAttribute("aria-label", `${ITEMS[id].uses} uses`);
      for (let i = 0; i < ITEMS[id].uses; i++) {
        const pip = document.createElement("i");
        pip.className = "pip";
        pips.append(pip);
      }
      const bring = document.createElement("span");
      bring.className = "item-bring";
      bring.textContent = BRING[id];
      tile.append(name, pips, bring);
      tile.addEventListener("click", () => {
        if (!this.current || this.current.loadout.includes(id)) return;
        // The older selection (index 0) leaves; the newer one moves up; the pick joins at the end.
        this.current.loadout = [this.current.loadout[1], id];
        for (const t of items.querySelectorAll<HTMLElement>(".item")) {
          t.setAttribute("aria-pressed", String(this.current.loadout.includes(t.dataset["item"] as ItemId)));
        }
        this.onChange(this.current.character, this.current.loadout);
      });
      items.append(tile);
    }

    root.append(heads, items);
  }
}

/** One plain sentence: "4 players, 2v2, best of 3 on Chaos, items on". */
export function describeConfig(config: MatchConfig): string {
  const mode = MODES[config.mode];
  const modeText = config.mode === "rounds"
    ? `best of ${mode.maxRounds}`
    : mode.roundTicks === null ? "deathmatch" : `one ${Math.round(mode.roundTicks / 60)} s round`;
  return `${config.players} players, ${TEAMS_LABEL[config.teams]}, ${modeText} on ${MAPS[config.map].label}, items ${config.items ? "on" : "off"}`;
}
