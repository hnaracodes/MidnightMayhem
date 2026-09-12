import Phaser from "phaser";
import {
  ARSENAL, BALANCE, ITEMS, ITEM_IDS, WORLD, createMatch,
  type Hazard, type ItemId, type MatchState, type PlayerIndex, type Projectile, type SimEvent,
} from "@midnight/shared";
import { ItemFx, type HandPoint } from "../game/itemFx";
import { P } from "../game/palette";
import { THROW, chargeToRange, throwVelocity } from "../game/throwPreview";

/**
 * Dev-only preview for 9.05 (`dev/itemfx.html`, not a build input). A night-1 fill, the roof line, two stand-in
 * rectangles with a marked hand, and a real `ItemFx`. `window.__itemfx.play(name)` fabricates the events and state
 * for one effect; `timeline()` plays every effect in sequence. Every visible effect is drawn by `ItemFx`; the only
 * thing drawn here besides the stand-ins is the dazzle overlay the scene owns (11.05), from `dazzleAlpha`.
 *
 * The fabricated sim advances one tick per render frame: projectiles fly under BALANCE.GRAVITY and land into
 * hazards, hazards age out, dazzle and the laser action count down.
 */

type Effect =
  | `equip-${ItemId}`
  | "laser" | "laser-hit" | "slash" | "parry"
  | "shield" | "absorb" | "break"
  | "molotov" | "banana" | "hazard-fire" | "hazard-peel" | "burn" | "slip"
  | "flash" | "flash-other"
  | "charge" | "charge-full" | "release"
  | "clear";

interface ItemFxDriver {
  play(name: Effect): void;
  /** Every effect name, in the order `timeline()` plays them. */
  list(): Effect[];
  /** Play every effect in turn, `gapFrames` render frames apart. */
  timeline(gapFrames?: number): void;
}

declare global {
  interface Window { __itemfx: ItemFxDriver }
}

const EFFECTS: Effect[] = [
  ...ITEM_IDS.map((id) => `equip-${id}` as const),
  "laser", "laser-hit", "slash", "parry",
  "shield", "absorb", "break",
  "molotov", "banana", "hazard-fire", "hazard-peel", "burn", "slip",
  "flash", "flash-other",
  "charge", "charge-full", "release",
];

const LOCAL: PlayerIndex = 0;
const HAND_ABOVE_FEET = 70; // 13.00: 100 × 0.7
const HAND_FORWARD = 21;
const DEPTH = { STAGE: 0, RIG: 2, LABEL: 10, DAZZLE: 12 } as const;

class ItemFxPreviewScene extends Phaser.Scene {
  private readonly state: MatchState = createMatch();
  private readonly pending: SimEvent[] = [];
  private readonly queue: Array<{ at: number; fn: () => void }> = [];
  private frame = 0;
  private itemFx!: ItemFx;
  private rects!: [Phaser.GameObjects.Graphics, Phaser.GameObjects.Graphics];
  private dazzle!: Phaser.GameObjects.Graphics;
  private label!: Phaser.GameObjects.Text;
  private current = "-";
  /** The fabricated punch key stays held while the throw preview charges (`release` lets go). */
  private chargeHeld = false;

  constructor() {
    super("itemfx-preview");
    this.state.phase = "FIGHTING";
    this.state.phaseTicks = 0;
  }

  create(): void {
    const stage = this.add.graphics().setDepth(DEPTH.STAGE);
    stage.fillStyle(P.night1, 1);
    stage.fillRect(0, 0, WORLD.WIDTH, WORLD.HEIGHT);
    stage.lineStyle(3, P.steel2, 1);
    stage.lineBetween(0, WORLD.ROOF_Y, WORLD.WIDTH, WORLD.ROOF_Y);

    this.rects = [this.add.graphics().setDepth(DEPTH.RIG), this.add.graphics().setDepth(DEPTH.RIG)];
    this.dazzle = this.add.graphics().setDepth(DEPTH.DAZZLE);
    this.itemFx = new ItemFx(this);
    this.label = this.add.text(12, WORLD.HEIGHT - 22, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#5B6375",
    }).setDepth(DEPTH.LABEL);

    window.__itemfx = {
      play: (name) => this.play(name),
      list: () => [...EFFECTS],
      timeline: (gapFrames = 90) => {
        EFFECTS.forEach((name, k) => this.later(k * gapFrames, () => this.play(name)));
      },
    };
  }

  update(_time: number, delta: number): void {
    this.frame += 1;
    for (let k = this.queue.length - 1; k >= 0; k -= 1) {
      const job = this.queue[k]!;
      if (job.at <= this.frame) {
        this.queue.splice(k, 1);
        job.fn();
      }
    }
    this.stepFabricatedSim();

    const hands = (i: PlayerIndex): HandPoint => this.hand(i);
    this.itemFx.consume(this.pending.splice(0), this.state, hands);
    this.itemFx.draw(this.state, hands, LOCAL);

    for (const i of [0, 1] as const) {
      const f = this.state.fighters[i]!;
      const g = this.rects[i];
      const w = WORLD.HURTBOX_W;
      const h = WORLD.HURTBOX_H;
      g.clear();
      g.fillStyle(i === 0 ? P.drifterKey : P.conductorKey, f.dazzle > 0 ? 0.6 : 1);
      g.fillRect(f.x - w / 2, f.y - h, w, h);
      g.lineStyle(3, P.outline, 1);
      g.strokeRect(f.x - w / 2, f.y - h, w, h);
      const hand = this.hand(i);
      g.fillStyle(this.itemFx.materialising(i) ? P.steel1 : P.moon, 1);
      g.fillCircle(hand.x, hand.y, 5);
      if (f.item && !this.itemFx.materialising(i)) {
        const k = this.itemFx.itemScale(i); // 9.08 rule 3: the sprite pops 1.6 → 1 as it appears
        g.fillStyle(P.amber1, 1);
        g.fillRect(hand.x - 4 * k, hand.y - 10 - 6 * k, 8 * k, 12 * k); // stand-in for 11.01's item sprite
      }
    }

    const alpha = this.itemFx.dazzleAlpha(this.state, LOCAL);
    this.dazzle.clear();
    if (alpha > 0) {
      this.dazzle.fillStyle(P.white, alpha);
      this.dazzle.fillRect(0, 0, WORLD.WIDTH, WORLD.HEIGHT);
    }

    this.itemFx.update(delta / 1000);

    const s = this.state;
    const items = s.fighters.map((f) => (f.item ? `${f.item.kind}:${f.item.uses}` : "-")).join(" ");
    this.label.setText(
      `tick ${s.tick}  ${this.current}  items ${items}  proj ${s.projectiles.length}  haz ${s.hazards.length}` +
      `  dazzle ${s.fighters[0]!.dazzle}  alpha ${alpha.toFixed(2)}`,
    );
  }

  // ---- fabricated sim (one tick per render frame) ----

  private hand(i: PlayerIndex): HandPoint {
    const f = this.state.fighters[i]!;
    return { x: f.x + f.facing * HAND_FORWARD, y: f.y - HAND_ABOVE_FEET };
  }

  private stepFabricatedSim(): void {
    const s = this.state;
    s.tick += 1;
    for (const f of s.fighters) {
      if (f.dazzle > 0) f.dazzle -= 1;
      if (f.action?.kind === "laser") {
        f.action.elapsed += 1;
        if (f.action.elapsed >= ARSENAL.LASER_CHARGE + ARSENAL.LASER_ACTIVE + ARSENAL.LASER_RECOVERY) f.action = null;
      }
      const charging = f.action as { kind: string; phase?: string; charge?: number } | null;
      if (charging?.kind === "throw" && charging.phase === "charge" && this.chargeHeld) {
        charging.charge = Math.min(THROW.CHARGE_MAX, (charging.charge ?? 0) + 1);
      }
    }
    for (let k = s.projectiles.length - 1; k >= 0; k -= 1) {
      const p = s.projectiles[k]!;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += BALANCE.GRAVITY;
      if (p.y >= WORLD.ROOF_Y || p.x < 0 || p.x > WORLD.WIDTH) {
        s.projectiles.splice(k, 1);
        const kind = p.kind === "molotov" ? "fire" : "peel";
        const hazard: Hazard = {
          id: s.nextId++, kind, owner: p.owner, x: clamp(p.x, 0, WORLD.WIDTH), y: WORLD.ROOF_Y,
          w: kind === "fire" ? ARSENAL.FIRE_W : ARSENAL.PEEL_W,
          ticks: kind === "fire" ? ARSENAL.FIRE_TICKS : ARSENAL.PEEL_TICKS, age: 0,
        };
        s.hazards.push(hazard);
        this.pending.push({ type: "HAZARD_SPAWN", id: hazard.id, kind, x: hazard.x });
      }
    }
    for (let k = s.hazards.length - 1; k >= 0; k -= 1) {
      const h = s.hazards[k]!;
      h.age += 1;
      if (h.age >= h.ticks) s.hazards.splice(k, 1);
    }
  }

  private later(frames: number, fn: () => void): void {
    this.queue.push({ at: this.frame + frames, fn });
  }

  private play(name: Effect): void {
    this.current = name;
    const s = this.state;
    const me = s.fighters[0]!;
    const other = s.fighters[1]!;
    if (name.startsWith("equip-")) {
      const item = name.slice("equip-".length) as ItemId;
      me.item = { kind: item, uses: ITEMS[item].uses };
      this.pending.push({ type: "ITEM_EQUIP", player: 0, item });
      return;
    }
    switch (name) {
      case "laser":
        me.action = { kind: "laser", elapsed: 0, hit: [] };
        this.pending.push({ type: "LASER_CHARGE", player: 0 });
        this.later(ARSENAL.LASER_CHARGE, () => {
          this.pending.push({ type: "LASER_FIRE", player: 0 });
          this.later(1, () => {
            this.pending.push({ type: "LASER_HIT", attacker: 0, target: 1, damage: ARSENAL.LASER_DAMAGE, blocked: false });
          });
        });
        break;
      case "laser-hit":
        this.pending.push({ type: "LASER_HIT", attacker: 0, target: 1, damage: ARSENAL.LASER_DAMAGE, blocked: false });
        break;
      case "slash":
        me.item = { kind: "sword", uses: ITEMS.sword.uses };
        me.action = { kind: "punch", arm: "R", elapsed: 0, landed: false, sword: true };
        this.pending.push({ type: "PUNCH", player: 0, arm: "R" });
        this.later(8, () => { if (me.action?.kind === "punch") me.action = null; });
        break;
      case "parry":
        other.item = { kind: "sword", uses: ITEMS.sword.uses };
        this.pending.push({ type: "PARRY", player: 1, attacker: 0 });
        break;
      case "shield":
        me.item = { kind: "shield", uses: ITEMS.shield.uses };
        break;
      case "absorb":
        if (me.item?.kind !== "shield") me.item = { kind: "shield", uses: ITEMS.shield.uses };
        me.item.uses = Math.max(0, me.item.uses - 1);
        this.pending.push({ type: "SHIELD_ABSORB", player: 0, left: me.item.uses });
        if (me.item.uses === 0) this.later(1, () => this.play("break"));
        break;
      case "break":
        me.item = null;
        this.pending.push({ type: "ITEM_BREAK", player: 0, item: "shield" });
        break;
      case "molotov":
      case "banana": {
        const hand = this.hand(0);
        const vx = name === "molotov" ? ARSENAL.MOLOTOV_VX : ARSENAL.BANANA_VX;
        const vy = name === "molotov" ? ARSENAL.MOLOTOV_VY : ARSENAL.BANANA_VY;
        const p: Projectile = { id: s.nextId++, kind: name, owner: 0, x: hand.x, y: hand.y, vx: me.facing * vx, vy };
        s.projectiles.push(p);
        this.pending.push({ type: "PROJECTILE_SPAWN", id: p.id, kind: name, owner: 0 });
        break;
      }
      case "hazard-fire":
      case "hazard-peel": {
        // A hazard placed directly between the fighters, for reviewing the tongues and the peel without a throw.
        const kind = name === "hazard-fire" ? "fire" : "peel";
        const hazard: Hazard = {
          id: s.nextId++, kind, owner: 0, x: (me.x + other.x) / 2, y: WORLD.ROOF_Y,
          w: kind === "fire" ? ARSENAL.FIRE_W : ARSENAL.PEEL_W,
          ticks: kind === "fire" ? ARSENAL.FIRE_TICKS : ARSENAL.PEEL_TICKS, age: 0,
        };
        s.hazards.push(hazard);
        this.pending.push({ type: "HAZARD_SPAWN", id: hazard.id, kind, x: hazard.x });
        break;
      }
      case "burn":
        this.pending.push({ type: "HAZARD_HIT", id: 0, kind: "fire", target: 1, damage: ARSENAL.FIRE_DAMAGE });
        break;
      case "slip":
        this.pending.push({ type: "HAZARD_HIT", id: 0, kind: "peel", target: 1, damage: 0 });
        break;
      case "flash":
        // The other fighter flashes: the local player is dazzled and sees the whiteout.
        me.dazzle = ARSENAL.DAZZLE_TICKS;
        this.pending.push({ type: "FLASH", player: 1 });
        break;
      case "flash-other":
        // The local player flashes: the burst at the hand is what everyone else sees.
        other.dazzle = ARSENAL.DAZZLE_TICKS;
        this.pending.push({ type: "FLASH", player: 0 });
        break;
      case "charge":
      case "charge-full": {
        // Lane A's charging ThrowAction (9.08); the sim's `charge` counts up while the key is held.
        if (me.item?.kind !== "molotov") me.item = { kind: "molotov", uses: ITEMS.molotov.uses };
        const charge = name === "charge-full" ? THROW.CHARGE_MAX : 0;
        me.action = { kind: "throw", item: "molotov", arm: "R", phase: "charge", charge, elapsed: 0, released: false } as unknown as NonNullable<typeof me.action>;
        this.chargeHeld = name === "charge";
        break;
      }
      case "release": {
        const a = me.action as { kind: string; charge?: number } | null;
        const charge = a?.kind === "throw" ? a.charge ?? 0 : THROW.CHARGE_MAX * 0.7;
        me.action = null;
        this.chargeHeld = false;
        const hand = this.hand(0);
        const v = throwVelocity(chargeToRange(charge));
        const p: Projectile = { id: s.nextId++, kind: "molotov", owner: 0, x: hand.x, y: hand.y, vx: me.facing * v.vx, vy: v.vy };
        s.projectiles.push(p);
        this.pending.push({ type: "PROJECTILE_SPAWN", id: p.id, kind: "molotov", owner: 0 });
        break;
      }
      case "clear":
        this.chargeHeld = false;
        me.item = null;
        other.item = null;
        me.action = null;
        me.dazzle = 0;
        other.dazzle = 0;
        s.projectiles = [];
        s.hazards = [];
        this.queue.length = 0;
        break;
      default:
        break;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// `?fps=10` slows the render loop so the driver can catch a 3-frame slash at its peak; effects count render
// frames, so a slow loop stretches them in wall time without changing what any frame looks like.
const fpsTarget = Math.max(1, Math.min(60, Number(new URLSearchParams(location.search).get("fps")) || 60));

new Phaser.Game({
  type: Phaser.AUTO,
  width: WORLD.WIDTH,
  height: WORLD.HEIGHT,
  parent: "itemfx",
  backgroundColor: "#070B18",
  fps: { target: fpsTarget, forceSetTimeOut: fpsTarget < 60 },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [ItemFxPreviewScene],
});
