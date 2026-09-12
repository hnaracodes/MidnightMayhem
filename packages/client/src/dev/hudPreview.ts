// Dev-only HUD preview. Not a build input. Mounts a 960 x 540 scene over a flat sky and roof band, constructs
// the real Hud, and lets the screenshot driver feed fake MatchStates through window.__hud.set(...).
//
// Query: ?players=2|3|4  &teams=ffa|2v2  &mode=rounds|timed|deathmatch  &phase=COUNTDOWN|FIGHTING|ROUND_END|MATCH_END
//        &plain=1 (fresh match, no demo scenario)
import Phaser from "phaser";
import {
  BALANCE,
  ARSENAL, CHARACTERS, ITEMS, WORLD, createMatch, normalizeConfig,
  type MatchConfig, type MatchState, type ModeId, type RosterEntry, type TeamsId,
} from "@midnight/shared";
import { Hud } from "../game/hud";
import { P } from "../game/palette";

type Partial2<T> = { [K in keyof T]?: T[K] extends object ? Partial2<T[K]> : T[K] };
interface PreviewPatch extends Partial2<MatchState> { names?: string[] }

declare global {
  interface Window { __hud: { set(stateJson: string | PreviewPatch): void; ready: boolean; state(): MatchState } }
}

const HEAD_Y = 250;
const query = new URLSearchParams(location.search);
const playersQ = Number(query.get("players") ?? 2);
const config: MatchConfig = normalizeConfig({
  players: playersQ === 3 ? 3 : playersQ === 4 ? 4 : 2,
  teams: (query.get("teams") as TeamsId | null) ?? "ffa",
  mode: (query.get("mode") as ModeId | null) ?? "rounds",
});
const roster: RosterEntry[] = [
  { character: CHARACTERS[0], loadout: ["sword", "flash"] },
  { character: CHARACTERS[1], loadout: ["shield", "molotov"] },
  { character: CHARACTERS[2], loadout: ["banana", "sword"] },
  { character: CHARACTERS[3], loadout: ["molotov", "banana"] },
];

let state: MatchState = createMatch(config, roster);
let hud: Hud | null = null;

/** A mid-fight tableau: every rule of 11.04 visible at once. */
function demo(s: MatchState): void {
  s.phase = "FIGHTING";
  s.round = 2;
  s.roundsWon = s.roundsWon.map((_, t) => (t === 0 ? 1 : 0));
  // Past the FIGHT banner: 77 s left of a timed round, 23 s of a 30 s round.
  if (s.roundTicks > 0) s.roundTicks = s.roundTicks > 30 * 60 ? 77 * 60 : 23 * 60;
  const [a, b, c, d] = s.fighters;
  if (a) {
    a.hp = 28;
    a.item = { kind: "sword", uses: 4 };
    a.itemsUsed = ["sword"];
    a.laserCooldown = 300;
  }
  if (b) {
    b.hp = 12;
    b.item = { kind: "shield", uses: 1 };
    b.itemsUsed = ["molotov", "shield"];
    b.laserCooldown = 0;
    b.dazzle = ARSENAL.DAZZLE_TICKS;
  }
  if (c) {
    c.hp = 0;
    c.itemsUsed = ["banana"];
    c.laserCooldown = 600;
  }
  if (d) {
    d.hp = 36;
    d.item = { kind: "banana", uses: ITEMS.banana.uses };
    d.itemsUsed = ["molotov", "banana"];
    d.laserCooldown = 40;
  }
  if (s.config.players === 2 && b) {
    // With two fighters a KO ends the round, so the second bar shows the dazzle and a spent loadout instead.
    b.hp = 9;
  }
}

if (query.get("plain") !== "1") demo(state);
// 12.05 rule 8: `?hp=<n>` sets every fighter's hp, `?low=<i>` puts one fighter at 1 HP for the low-HP state
const hpQ = Number(query.get("hp"));
if (Number.isFinite(hpQ) && query.get("hp") !== null) for (const f of state.fighters) f.hp = Math.max(0, Math.min(BALANCE.MAX_HP, hpQ));
const lowQ = Number(query.get("low"));
if (query.get("low") !== null && state.fighters[lowQ]) state.fighters[lowQ]!.hp = 1;
const phase = query.get("phase") as MatchState["phase"] | null;
if (phase) {
  state.phase = phase;
  if (phase === "MATCH_END") state.winner = 0;
  if (phase === "COUNTDOWN") state.phaseTicks = 120;
  if (phase === "ROUND_END") for (const f of state.fighters) if (f.team !== 0) f.hp = 0;
}

function merge<T extends object>(base: T, patch: Partial2<T>): T {
  const out: T = Array.isArray(base) ? ([...(base as unknown[])] as unknown as T) : { ...base };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    const current = base[key];
    if (value !== undefined && value !== null && typeof value === "object" && current && typeof current === "object") {
      out[key] = merge(current as object, value as object) as T[typeof key];
    } else if (value !== undefined) {
      out[key] = value as T[typeof key];
    }
  }
  return out;
}

window.__hud = {
  ready: false,
  state: () => state,
  set(stateJson) {
    const patch: PreviewPatch = typeof stateJson === "string" ? JSON.parse(stateJson) : stateJson;
    const { names, ...rest } = patch;
    state = merge(state, rest);
    if (names && hud) hud.setNames(names);
  },
};

class HudPreviewScene extends Phaser.Scene {
  constructor() {
    super("hud-preview");
  }

  create(): void {
    const stage = this.add.graphics();
    stage.fillStyle(P.night1, 1);
    stage.fillRect(0, 0, WORLD.WIDTH, WORLD.ROOF_Y);
    stage.fillStyle(P.steel1, 1);
    stage.fillRect(0, WORLD.ROOF_Y, WORLD.WIDTH, WORLD.HEIGHT - WORLD.ROOF_Y);
    stage.fillStyle(P.steel2, 1);
    stage.fillRect(0, WORLD.ROOF_Y + 12, WORLD.WIDTH, 3);
    // Head-height guide: rig crowns sit near y 250, the HUD band must end well above it.
    stage.lineStyle(1, P.night2, 1);
    stage.lineBetween(0, HEAD_Y, WORLD.WIDTH, HEAD_Y);
    hud = new Hud(this);
    hud.update(state, 0);
    window.__hud.ready = true;
  }

  update(_time: number, delta: number): void {
    hud?.update(state, delta / 1000);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: WORLD.WIDTH,
  height: WORLD.HEIGHT,
  parent: "game",
  backgroundColor: "#101A33",
  scene: [HudPreviewScene],
});
