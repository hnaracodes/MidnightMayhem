import type Phaser from "phaser";
import {
  ARSENAL, ITEMS, WORLD, laserHitbox, laserReach,
  type Facing, type FighterState, type Hazard, type ItemId, type MatchState, type PlayerIndex, type Projectile,
  type SimEvent,
} from "@midnight/shared";
import { P } from "./palette";

/**
 * 9.05 — Item and laser effects. Everything the arsenal draws *around* the item sprites (11.01 draws the item in the
 * hand): materialise, laser charge ring and beam, sword slash, parry spark, shield bubble and shards, molotov and
 * banana in flight, fire tongues, banana peel, hazard hits and the flashbang burst. Event-driven or state-read,
 * never predicted, never mutating.
 *
 * Per render frame the scene calls, in this order: `consume(events, newest, hands)`, `draw(state, hands, local)`,
 * the readers (`materialising`, `dazzleAlpha`), then `update(dtSec)`. Every timer counts render frames.
 *
 * Only structural `{ x, y }` points cross this boundary; nothing here imports from `rig/` or `sprites/`. Hand
 * positions come in through the `hands` callback.
 */

export interface HandPoint { x: number; y: number }

type Pt = { x: number; y: number };
type Graphics = Phaser.GameObjects.Graphics;

/** Presentation timings in render frames at 60 Hz. Gameplay numbers stay in `@midnight/shared`. */
const FRAMES = {
  MATERIALISE_IMPLODE: 20,
  MATERIALISE_FLASH: 6,
  MATERIALISE: 26,
  CHARGE: ARSENAL.LASER_CHARGE,
  BEAM: ARSENAL.LASER_ACTIVE,
  BEAM_FADE: 10,
  BEAM_SHAKE: 8,
  IMPACT: 6,
  SLASH: 3,
  PARRY: 6,
  PARRY_SHAKE: 8, // the spark is 6 frames; the 2 px shake decays over 8
  ABSORB_FLASH: 2,
  SHARDS: 10,
  FEET_FLASH: 5,
  SLIP_STARS: 6,
  FLASH_BURST: 6,
} as const;

const FRAME_MS = 1000 / 60;
const DEPTH = { FX: 4, PROJECTILE: 4, HAZARD: 0.5, BEAM: 4.5, BUBBLE: 4 } as const;

const MATERIALISE_PARTICLES = 14;
const MATERIALISE_RING_R = 40;
const MATERIALISE_DISC_R = 14;
const CHARGE_R0 = 6;
const CHARGE_R1 = 22;
const CHARGE_DOTS = 3;
const CHARGE_ORBITS = 6; // full turns of the dots over the 3 s charge (two per second)
const BEAM_CORE_FRACTION = 0.5; // core thickness as a fraction of the band (the beam fills the band: half the sprite height)
const BEAM_EDGE_ALPHA = 0.6;
const BEAM_SHAKE_PX = 4;
const PARRY_SHAKE_PX = 2;
const CHEST_ABOVE_FEET = 90;
const IMPACT_OFFSET = 20;
const IMPACT_LENGTHS = [26, 16, 22, 14, 26, 18, 20, 14] as const;
const SLASH_REACH = ARSENAL.SWORD_REACH;
const SLASH_SWEEP = Math.PI / 3; // 60°
const BUBBLE_W = 90;
const BUBBLE_H = 150;
const BUBBLE_ALPHA = 0.3;
const SHARD_COUNT = 8;
const MOLOTOV_R = 8;
const MOLOTOV_FLAME = 12;
const TRAIL_POINTS = 6;
const BANANA_R = 10;
const BANANA_SPIN = (15 * Math.PI) / 180;
const FIRE_TONGUES = 7;
const FIRE_H_MIN = 18;
const FIRE_H_MAX = 34;
const FIRE_HZ = 8;
const SCORCH_ALPHA = 0.25;
const HAZARD_FADE_TICKS = 30;
const PEEL_R = 14;
const STAR_R = 7;
const STARS_ABOVE_HEAD = 14;
const STAR_ORBIT = 22;

/** Particle accent per item (rule 1). */
const ACCENT: Record<ItemId, number> = {
  molotov: P.danger,
  sword: P.moon,
  shield: P.steel2,
  banana: P.amber1,
  flash: P.white,
};

/** What an anchored effect re-reads every frame: the hand, where the fighter faces and, for the beam, the fighter's centre and band. */
interface Anchor { at: Pt; origin: Pt; facing: Facing; band: { top: number; bottom: number } }

interface Timed {
  g: Graphics;
  frame: number;
  total: number;
  /** Drawn on spawn (frame 0) and after every advance; `t` runs 0 → 1 over the lifetime. */
  draw: (g: Graphics, t: number, frame: number, anchor: Anchor) => void;
  /** True until the first `update` after spawn so the spawn frame is rendered once. */
  fresh: boolean;
  /** Set when the effect follows a fighter's hand; `draw()` refreshes the anchor and redraws. */
  player: PlayerIndex | null;
  anchor: Anchor;
  /** Used to find and cut short the charge ring when LASER_FIRE arrives. */
  tag: "ring" | "beam" | null;
}

interface Flight { g: Graphics; trail: Pt[]; spin: number }

/** One entry per player slot (08-contracts: up to four fighters); `state.fighters` says how many are live. */
type Per<T> = [T, T, T, T];
const per = <T>(v: T): Per<T> => [v, v, v, v];
const PLAYERS: readonly PlayerIndex[] = [0, 1, 2, 3];

export class ItemFx {
  private readonly timed: Timed[] = [];
  private readonly projectiles = new Map<number, Flight>();
  private readonly hazards = new Map<number, Graphics>();
  private readonly bubbles: Per<Graphics | null> = per(null);
  private readonly materialiseFrames: Per<number> = per(0);
  private readonly absorbFrames: Per<number> = per(0);
  private clockSec = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  /** Drain once per render frame with the newest snapshot (the one that carried the events). */
  consume(events: SimEvent[], newest: MatchState, hands: (i: PlayerIndex) => HandPoint): void {
    for (const event of events) this.onEvent(event, newest, hands);
  }

  /** Draw state-driven visuals: projectiles, hazards, beams, shield bubble, charge ring. */
  draw(state: MatchState, hands: (i: PlayerIndex) => HandPoint, _localIndex: PlayerIndex): void {
    this.drawProjectiles(state.projectiles);
    this.drawHazards(state.hazards);
    for (const i of PLAYERS) this.drawBubble(i, state.fighters[i]);
    for (const fx of this.timed) {
      if (fx.player === null) continue;
      const f = state.fighters[fx.player];
      fx.anchor = anchorFor(hands(fx.player), f);
      fx.draw(fx.g, fx.frame / fx.total, fx.frame, fx.anchor);
    }
  }

  /** Advance every timer by one render frame; `dtSec` drives the 8 Hz fire flicker. */
  update(dtSec: number): void {
    this.clockSec += dtSec;
    for (const i of PLAYERS) {
      if (this.materialiseFrames[i] > 0) this.materialiseFrames[i] -= 1;
      if (this.absorbFrames[i] > 0) this.absorbFrames[i] -= 1;
    }
    for (let k = this.timed.length - 1; k >= 0; k -= 1) {
      const fx = this.timed[k]!;
      if (fx.fresh) { fx.fresh = false; continue; }
      fx.frame += 1;
      if (fx.frame >= fx.total) {
        fx.g.destroy();
        this.timed.splice(k, 1);
      } else {
        fx.draw(fx.g, fx.frame / fx.total, fx.frame, fx.anchor);
      }
    }
  }

  /** 0..1 whiteout strength for the local player's dazzle; the scene draws the overlay. */
  dazzleAlpha(state: MatchState, localIndex: PlayerIndex): number {
    const f = state.fighters[localIndex];
    if (!f || f.dazzle <= 0) return 0;
    // `dazzle` counts down from DAZZLE_TICKS (120): full for the first 90 ticks, then linear to 0 over the last 30.
    return Math.min(1, f.dazzle / (ARSENAL.DAZZLE_TICKS / 4));
  }

  /** True while a materialise animation is running for that fighter (11.01 hides the item sprite until it ends). */
  materialising(i: PlayerIndex): boolean {
    return this.materialiseFrames[i] > 0;
  }

  destroy(): void {
    for (const fx of this.timed) fx.g.destroy();
    this.timed.length = 0;
    for (const flight of this.projectiles.values()) flight.g.destroy();
    this.projectiles.clear();
    for (const g of this.hazards.values()) g.destroy();
    this.hazards.clear();
    for (const i of PLAYERS) {
      this.bubbles[i]?.destroy();
      this.bubbles[i] = null;
      this.materialiseFrames[i] = 0;
      this.absorbFrames[i] = 0;
    }
  }

  // ---- events ----

  private onEvent(event: SimEvent, newest: MatchState, hands: (i: PlayerIndex) => HandPoint): void {
    switch (event.type) {
      case "ITEM_EQUIP": {
        const accent = ACCENT[event.item];
        this.materialiseFrames[event.player] = FRAMES.MATERIALISE;
        this.spawnAnchored(event.player, hands, newest, FRAMES.MATERIALISE, DEPTH.FX, null,
          (g, _t, frame, a) => drawMaterialise(g, a.at, frame, accent));
        break;
      }
      case "LASER_CHARGE":
        // The ring grows over its own frame index so it reaches r 22 on its last frame (frame 29 of 30).
        this.spawnAnchored(event.player, hands, newest, FRAMES.CHARGE, DEPTH.FX, "ring",
          (g, _t, frame, a) => drawChargeRing(g, a.at, frame / (FRAMES.CHARGE - 1)));
        break;
      case "LASER_FIRE": {
        this.cut("ring", event.player);
        this.spawnAnchored(event.player, hands, newest, FRAMES.BEAM + FRAMES.BEAM_FADE, DEPTH.BEAM, "beam",
          (g, _t, frame, a) => drawBeam(g, a, frame));
        this.shake(BEAM_SHAKE_PX, FRAMES.BEAM_SHAKE);
        break;
      }
      case "LASER_HIT": {
        const target = newest.fighters[event.target];
        const attacker = newest.fighters[event.attacker];
        if (!target || !attacker) break;
        const toward = attacker.x !== target.x ? Math.sign(attacker.x - target.x) : target.facing;
        const at = { x: target.x + toward * IMPACT_OFFSET, y: target.y - CHEST_ABOVE_FEET };
        this.spawn(FRAMES.IMPACT, DEPTH.FX, (g, t) => drawImpact(g, at, t));
        break;
      }
      case "PUNCH": {
        const f = newest.fighters[event.player];
        if (!f || !holdsSword(f)) break;
        const origin = { x: f.x, y: f.y - CHEST_ABOVE_FEET };
        const facing = f.facing;
        this.spawn(FRAMES.SLASH, DEPTH.FX, (g, t) => drawSlash(g, origin, facing, t));
        break;
      }
      case "PARRY": {
        const at = hands(event.player);
        this.spawn(FRAMES.PARRY, DEPTH.FX, (g, t) => drawSparkStar(g, at, t));
        this.shake(PARRY_SHAKE_PX, FRAMES.PARRY_SHAKE);
        break;
      }
      case "SHIELD_ABSORB":
        this.absorbFrames[event.player] = FRAMES.ABSORB_FLASH;
        break;
      case "ITEM_BREAK": {
        if (event.item !== "shield") break;
        const f = newest.fighters[event.player];
        if (!f) break;
        const centre = { x: f.x, y: f.y - BUBBLE_H / 2 };
        this.spawn(FRAMES.SHARDS, DEPTH.FX, (g, t) => drawShards(g, centre, t));
        break;
      }
      case "HAZARD_HIT": {
        const f = newest.fighters[event.target];
        if (!f) break;
        if (event.damage > 0) {
          const feet = { x: f.x, y: f.y };
          this.spawn(FRAMES.FEET_FLASH, DEPTH.FX, (g, t) => drawFeetFlash(g, feet, t));
        } else {
          const head = { x: f.x, y: f.y - WORLD.HURTBOX_H - STARS_ABOVE_HEAD };
          this.spawn(FRAMES.SLIP_STARS, DEPTH.FX, (g, t) => drawSlipStars(g, head, t));
        }
        break;
      }
      case "FLASH": {
        // Non-dazzled fighters see the burst at the flasher's hand; under a full whiteout it is simply not visible.
        const at = hands(event.player);
        this.spawn(FRAMES.FLASH_BURST, DEPTH.FX, (g, t) => drawFlashBurst(g, at, t));
        break;
      }
      default:
        break;
    }
  }

  private shake(px: number, frames: number): void {
    const ix = px / WORLD.WIDTH;
    const iy = px / WORLD.HEIGHT;
    // Intensity starts at 0 and is set per update from the callback (which Phaser runs before it computes the
    // offset), giving a `px` amplitude that decays to 0 over `frames`.
    this.scene.cameras.main.shake(
      frames * FRAME_MS,
      0,
      true,
      (camera: Phaser.Cameras.Scene2D.Camera, progress: number) => {
        camera.shakeEffect.intensity.set(ix * (1 - progress), iy * (1 - progress));
      },
    );
  }

  // ---- timed effects ----

  private spawn(total: number, depth: number, draw: (g: Graphics, t: number) => void): void {
    const g = this.scene.add.graphics().setDepth(depth);
    draw(g, 0);
    this.timed.push({
      g, frame: 0, total, draw, fresh: true, player: null, tag: null,
      anchor: { at: { x: 0, y: 0 }, origin: { x: 0, y: 0 }, facing: 1, band: laserBand(undefined) },
    });
  }

  private spawnAnchored(
    player: PlayerIndex,
    hands: (i: PlayerIndex) => HandPoint,
    newest: MatchState,
    total: number,
    depth: number,
    tag: Timed["tag"],
    draw: Timed["draw"],
  ): void {
    const anchor = anchorFor(hands(player), newest.fighters[player]);
    const g = this.scene.add.graphics().setDepth(depth);
    draw(g, 0, 0, anchor);
    this.timed.push({ g, frame: 0, total, draw, fresh: true, player, anchor, tag });
  }

  /** Destroy every tagged effect anchored to `player` (the charge ring once the beam starts). */
  private cut(tag: Timed["tag"], player: PlayerIndex): void {
    for (let k = this.timed.length - 1; k >= 0; k -= 1) {
      const fx = this.timed[k]!;
      if (fx.tag !== tag || fx.player !== player) continue;
      fx.g.destroy();
      this.timed.splice(k, 1);
    }
  }

  // ---- state-driven visuals ----

  private drawProjectiles(list: Projectile[]): void {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let flight = this.projectiles.get(p.id);
      if (!flight) {
        flight = { g: this.scene.add.graphics().setDepth(DEPTH.PROJECTILE), trail: [], spin: 0 };
        this.projectiles.set(p.id, flight);
      }
      flight.trail.push({ x: p.x, y: p.y });
      if (flight.trail.length > TRAIL_POINTS) flight.trail.shift();
      if (p.kind === "molotov") {
        drawMolotov(flight.g, p, flight.trail);
      } else {
        drawBanana(flight.g, p, flight.spin);
        flight.spin += BANANA_SPIN;
      }
    }
    for (const [id, flight] of this.projectiles) {
      if (seen.has(id)) continue;
      flight.g.destroy();
      this.projectiles.delete(id);
    }
  }

  private drawHazards(list: Hazard[]): void {
    const seen = new Set<number>();
    for (const h of list) {
      seen.add(h.id);
      let g = this.hazards.get(h.id);
      if (!g) {
        g = this.scene.add.graphics().setDepth(DEPTH.HAZARD);
        this.hazards.set(h.id, g);
      }
      const remaining = h.ticks - h.age;
      const fade = clamp(remaining / HAZARD_FADE_TICKS, 0, 1);
      if (h.kind === "fire") drawFire(g, h, fade, this.clockSec);
      else drawPeel(g, h, fade);
    }
    for (const [id, g] of this.hazards) {
      if (seen.has(id)) continue;
      g.destroy();
      this.hazards.delete(id);
    }
  }

  private drawBubble(i: PlayerIndex, f: FighterState | undefined): void {
    const item = f?.item;
    // No bubble while the shield is still materialising (11.01 hides the item sprite until then too), nor while the
    // fighter is down a pit: the sprite is hidden for those 40 ticks and the bubble is tied to the fighter (9.05 rule 4).
    if (!f || !item || item.kind !== "shield" || this.materialiseFrames[i] > 0 || f.pitTicks > 0) {
      const old = this.bubbles[i];
      if (old) {
        old.destroy();
        this.bubbles[i] = null;
      }
      return;
    }
    const g = (this.bubbles[i] ??= this.scene.add.graphics().setDepth(DEPTH.BUBBLE));
    const cracks = Math.max(0, ITEMS.shield.uses - item.uses);
    drawBubble(g, { x: f.x, y: f.y - BUBBLE_H / 2 }, cracks, this.absorbFrames[i] > 0);
  }
}

/**
 * The beam's y band for a fighter, from 9.03's `laserHitbox`. The fighter is forced into the beam phase so the band
 * is defined during the drawn fade (recover phase) too; only its y/h are used, the drawn beam starts at the fighter's centre.
 */
function laserBand(f: FighterState | undefined): { top: number; bottom: number } {
  const rect = f ? laserHitbox({ ...f, action: { kind: "laser", elapsed: ARSENAL.LASER_CHARGE, hit: [] } }) : null;
  if (!rect) return { top: WORLD.ROOF_Y - ARSENAL.LASER_BAND_TOP, bottom: WORLD.ROOF_Y - ARSENAL.LASER_BAND_BOTTOM };
  return { top: rect.y, bottom: rect.y + rect.h };
}

function anchorFor(hand: HandPoint, f: FighterState | undefined): Anchor {
  const band = laserBand(f);
  return { at: { x: hand.x, y: hand.y }, origin: { x: f?.x ?? hand.x, y: (band.top + band.bottom) / 2 }, facing: f?.facing ?? 1, band };
}

function holdsSword(f: FighterState): boolean {
  // The last swing breaks the sword in the same tick (item null + ITEM_BREAK), so the action flag also counts.
  return f.item?.kind === "sword" || (f.action?.kind === "punch" && f.action.sword);
}

// ---- pure drawing helpers (world coordinates) ----

/** Rule 1: 14 particles implode from a 40 px ring over 20 frames, then a moon disc r 14 fading over 6. */
function drawMaterialise(g: Graphics, hand: Pt, frame: number, accent: number): void {
  g.clear();
  if (frame < FRAMES.MATERIALISE_IMPLODE) {
    const t = frame / FRAMES.MATERIALISE_IMPLODE;
    const r = MATERIALISE_RING_R * (1 - t * t);
    g.fillStyle(accent, 0.55 + 0.45 * t);
    for (let k = 0; k < MATERIALISE_PARTICLES; k += 1) {
      const ang = (k / MATERIALISE_PARTICLES) * Math.PI * 2 + t * 1.2;
      g.fillCircle(hand.x + Math.cos(ang) * r, hand.y + Math.sin(ang) * r, 2 + 1.5 * t);
    }
    return;
  }
  const u = (frame - FRAMES.MATERIALISE_IMPLODE) / FRAMES.MATERIALISE_FLASH;
  g.fillStyle(P.moon, 1 - u);
  g.fillCircle(hand.x, hand.y, MATERIALISE_DISC_R);
  g.lineStyle(2, accent, 0.8 * (1 - u));
  g.strokeCircle(hand.x, hand.y, MATERIALISE_DISC_R + 10 * u);
}

/** Rule 2: ring r 6 → 22 with three orbiting amber dots. */
function drawChargeRing(g: Graphics, hand: Pt, t: number): void {
  const r = CHARGE_R0 + (CHARGE_R1 - CHARGE_R0) * t;
  g.clear();
  g.lineStyle(2, P.amber1, 0.5 + 0.5 * t);
  g.strokeCircle(hand.x, hand.y, r);
  g.fillStyle(P.amber1, 1);
  for (let k = 0; k < CHARGE_DOTS; k += 1) {
    const ang = (k / CHARGE_DOTS) * Math.PI * 2 + t * CHARGE_ORBITS * Math.PI * 2;
    g.fillCircle(hand.x + Math.cos(ang) * r, hand.y + Math.sin(ang) * r, 3);
  }
}

/**
 * Rule 2: beam from the fighter's centre toward the world edge, filling the band (half the sprite height); its front
 * travels `LASER_SPEED` px per frame like the sim hitbox, then holds full length through the 10-frame fade.
 */
function drawBeam(g: Graphics, a: Anchor, frame: number): void {
  const band = a.band;
  const thickness = band.bottom - band.top;
  const y = a.origin.y;
  const reach = laserReach(Math.min(frame, FRAMES.BEAM - 1));
  const w = Math.min(reach, a.facing === 1 ? WORLD.WIDTH - a.origin.x : a.origin.x);
  const x = a.facing === 1 ? a.origin.x : a.origin.x - w;
  const fade = frame < FRAMES.BEAM ? 1 : (FRAMES.BEAM + FRAMES.BEAM_FADE - frame) / (FRAMES.BEAM_FADE + 1);
  g.clear();
  g.fillStyle(P.amber1, BEAM_EDGE_ALPHA * fade);
  g.fillRect(x, y - thickness / 2, w, thickness);
  g.fillStyle(P.moon, fade);
  g.fillRect(x, y - (thickness * BEAM_CORE_FRACTION) / 2, w, thickness * BEAM_CORE_FRACTION);
  g.fillCircle(a.origin.x, y, thickness / 2);
}

/** `fx_impact` recipe from 4.06 rule 1: 8 radial amber lines plus a moon core, scale 0.6 → 1.3, fading. */
function drawImpact(g: Graphics, at: Pt, t: number): void {
  const s = 0.6 + 0.7 * t;
  const a = 1 - t;
  g.clear();
  g.lineStyle(3, P.amber1, a);
  const inner = 6 * s;
  for (let k = 0; k < IMPACT_LENGTHS.length; k += 1) {
    const ang = (k / IMPACT_LENGTHS.length) * Math.PI * 2 + Math.PI / 16;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const outer = inner + IMPACT_LENGTHS[k]! * s;
    g.lineBetween(at.x + cos * inner, at.y + sin * inner, at.x + cos * outer, at.y + sin * outer);
  }
  g.fillStyle(P.moon, a);
  g.fillCircle(at.x, at.y, 10 * s);
}

/** Rule 3: a 60° moon arc 130 px in front of the chest, sweeping top → bottom over 3 frames. */
function drawSlash(g: Graphics, origin: Pt, facing: Facing, t: number): void {
  const centre = facing === 1 ? -SLASH_SWEEP / 2 : Math.PI - SLASH_SWEEP / 2; // toward the facing side
  const start = centre;
  const end = centre + SLASH_SWEEP * Math.min(1, 0.4 + t);
  const outer = SLASH_REACH;
  const inner = SLASH_REACH - 22;
  const segments = 12;
  const pts: Pt[] = [];
  for (let k = 0; k <= segments; k += 1) {
    const ang = start + (end - start) * (k / segments);
    pts.push({ x: origin.x + Math.cos(ang) * outer, y: origin.y + Math.sin(ang) * outer });
  }
  for (let k = segments; k >= 0; k -= 1) {
    const ang = start + (end - start) * (k / segments);
    const r = inner + (outer - inner) * 0.55 * (1 - k / segments);
    pts.push({ x: origin.x + Math.cos(ang) * r, y: origin.y + Math.sin(ang) * r });
  }
  g.clear();
  g.fillStyle(P.moon, 0.85 * (1 - 0.5 * t));
  g.fillPoints(pts, true);
}

/** Rule 3: a six-point white spark star that grows and fades over 6 frames. */
function drawSparkStar(g: Graphics, at: Pt, t: number): void {
  const r = 10 + 18 * t;
  g.clear();
  g.lineStyle(3, P.white, 1 - t);
  for (let k = 0; k < 6; k += 1) {
    const ang = (k / 6) * Math.PI * 2;
    g.lineBetween(at.x - Math.cos(ang) * r, at.y - Math.sin(ang) * r, at.x + Math.cos(ang) * r, at.y + Math.sin(ang) * r);
  }
  g.fillStyle(P.white, 1 - t);
  g.fillCircle(at.x, at.y, 5 * (1 - t) + 2);
}

/** Rule 4: steel-2 30 % ellipse 90 × 150 with `cracks` lines; moon while an absorb flashes. */
function drawBubble(g: Graphics, centre: Pt, cracks: number, flash: boolean): void {
  g.clear();
  g.fillStyle(flash ? P.moon : P.steel2, flash ? 0.6 : BUBBLE_ALPHA);
  g.fillEllipse(centre.x, centre.y, BUBBLE_W, BUBBLE_H);
  g.lineStyle(2, flash ? P.moon : P.steel2, 0.9);
  g.strokeEllipse(centre.x, centre.y, BUBBLE_W, BUBBLE_H);
  g.lineStyle(2, P.moon, 0.8);
  for (let k = 0; k < cracks; k += 1) {
    // Deterministic jagged cracks from the rim inward, one per absorbed hit.
    const ang = -0.6 + k * 2.1;
    const rx = (BUBBLE_W / 2) * Math.cos(ang);
    const ry = (BUBBLE_H / 2) * Math.sin(ang);
    const x0 = centre.x + rx;
    const y0 = centre.y + ry;
    const x1 = centre.x + rx * 0.45 + (k % 2 ? 8 : -8);
    const y1 = centre.y + ry * 0.45 + (k % 2 ? -6 : 6);
    g.lineBetween(x0, y0, x1, y1);
  }
}

/** Rule 4: 8 steel shards flying out from the bubble over 10 frames. */
function drawShards(g: Graphics, centre: Pt, t: number): void {
  g.clear();
  g.fillStyle(P.steel2, 1 - t);
  for (let k = 0; k < SHARD_COUNT; k += 1) {
    const ang = (k / SHARD_COUNT) * Math.PI * 2 + 0.3;
    const dist = 30 + 90 * t;
    const x = centre.x + Math.cos(ang) * dist;
    const y = centre.y + Math.sin(ang) * dist * (BUBBLE_H / BUBBLE_W) + 30 * t * t;
    const s = 9 - 3 * t;
    const rot = ang + t * 3;
    g.fillTriangle(
      x + Math.cos(rot) * s, y + Math.sin(rot) * s,
      x + Math.cos(rot + 2.4) * s, y + Math.sin(rot + 2.4) * s,
      x + Math.cos(rot + 4.2) * s * 0.6, y + Math.sin(rot + 4.2) * s * 0.6,
    );
  }
}

/** Rule 5: an 8 px steel bottle with a 12 px amber flame tail and a trail through the last 6 positions. */
function drawMolotov(g: Graphics, p: Projectile, trail: Pt[]): void {
  g.clear();
  g.lineStyle(3, P.amber1, 0.35);
  for (let k = 1; k < trail.length; k += 1) {
    const a = trail[k - 1]!;
    const b = trail[k]!;
    g.lineBetween(a.x, a.y, b.x, b.y);
  }
  const dir = Math.atan2(p.vy, p.vx);
  const tx = p.x - Math.cos(dir) * MOLOTOV_FLAME;
  const ty = p.y - Math.sin(dir) * MOLOTOV_FLAME;
  const nx = -Math.sin(dir) * 4;
  const ny = Math.cos(dir) * 4;
  g.fillStyle(P.amber1, 0.9);
  g.fillTriangle(p.x + nx, p.y + ny, p.x - nx, p.y - ny, tx, ty);
  g.fillStyle(P.steel2, 1);
  g.fillCircle(p.x, p.y, MOLOTOV_R);
  g.lineStyle(2, P.outline, 1);
  g.strokeCircle(p.x, p.y, MOLOTOV_R);
}

/** Rule 5: a 10 px amber crescent spinning 15° per frame. */
function drawBanana(g: Graphics, p: Projectile, spin: number): void {
  g.clear();
  g.fillStyle(P.amber1, 1);
  g.fillPoints(crescent({ x: p.x, y: p.y }, BANANA_R, spin), true);
  g.lineStyle(2, P.outline, 1);
  g.strokePoints(crescent({ x: p.x, y: p.y }, BANANA_R, spin), true);
}

/** Rule 5: seven flame tongues along `w`, 18–34 px at 8 Hz alternating danger/amber, over a night-0 scorch. */
function drawFire(g: Graphics, h: Hazard, fade: number, clockSec: number): void {
  const x0 = h.x - h.w / 2;
  const step = h.w / FIRE_TONGUES;
  g.clear();
  g.fillStyle(P.night0, SCORCH_ALPHA * fade);
  g.fillEllipse(h.x, h.y, h.w + 16, 14);
  for (let k = 0; k < FIRE_TONGUES; k += 1) {
    const cx = x0 + step * (k + 0.5);
    const phase = k * 1.7;
    const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * FIRE_HZ * clockSec + phase);
    const height = FIRE_H_MIN + (FIRE_H_MAX - FIRE_H_MIN) * wave;
    const lean = 4 * Math.sin(2 * Math.PI * FIRE_HZ * 0.5 * clockSec + phase);
    g.fillStyle(k % 2 === 0 ? P.danger : P.amber1, (0.85 + 0.15 * wave) * fade);
    g.fillTriangle(cx - step * 0.5, h.y, cx + step * 0.5, h.y, cx + lean, h.y - height);
  }
}

/** Rule 5: a 14 px flat amber crescent on the roof with two outline stripes. */
function drawPeel(g: Graphics, h: Hazard, fade: number): void {
  const centre = { x: h.x, y: h.y - 3 };
  g.clear();
  g.fillStyle(P.amber1, fade);
  g.fillPoints(crescent(centre, PEEL_R, Math.PI / 2, 0.45), true); // convex side down: lying flat on the roof
  g.lineStyle(2, P.outline, fade);
  g.lineBetween(centre.x - 6, centre.y - 1, centre.x - 2, centre.y - 5);
  g.lineBetween(centre.x + 2, centre.y - 5, centre.x + 6, centre.y - 1);
}

/** Rule 6: a small danger flash at the feet. */
function drawFeetFlash(g: Graphics, feet: Pt, t: number): void {
  g.clear();
  g.fillStyle(P.danger, 0.8 * (1 - t));
  g.fillEllipse(feet.x, feet.y - 4, 40 + 30 * t, 14 + 8 * t);
}

/** Rule 6: three moon stars spinning over the head for 6 frames. */
function drawSlipStars(g: Graphics, head: Pt, t: number): void {
  g.clear();
  g.fillStyle(P.moon, 1 - 0.5 * t);
  for (let k = 0; k < 3; k += 1) {
    const ang = (k / 3) * Math.PI * 2 + t * Math.PI * 2;
    const x = head.x + Math.cos(ang) * STAR_ORBIT;
    const y = head.y + Math.sin(ang) * STAR_ORBIT * 0.35;
    g.fillPoints(star({ x, y }, STAR_R, ang), true);
  }
}

/** Rule 7: a 6-frame white burst at the flasher's hand for everyone who is not dazzled. */
function drawFlashBurst(g: Graphics, at: Pt, t: number): void {
  g.clear();
  g.fillStyle(P.white, 0.9 * (1 - t));
  g.fillCircle(at.x, at.y, 18 + 50 * t);
  g.lineStyle(2, P.white, 0.7 * (1 - t));
  for (let k = 0; k < 8; k += 1) {
    const ang = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const r0 = 24 + 50 * t;
    const r1 = r0 + 20;
    g.lineBetween(at.x + Math.cos(ang) * r0, at.y + Math.sin(ang) * r0, at.x + Math.cos(ang) * r1, at.y + Math.sin(ang) * r1);
  }
}

// ---- shapes ----

/** A crescent: an outer arc of radius `r` and an inner arc pushed toward the open side, rotated by `rot`. */
function crescent(centre: Pt, r: number, rot: number, thickness = 0.6): Pt[] {
  const pts: Pt[] = [];
  const segments = 10;
  const span = Math.PI * 1.1;
  for (let k = 0; k <= segments; k += 1) {
    const ang = -span / 2 + span * (k / segments);
    pts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
  }
  for (let k = segments; k >= 0; k -= 1) {
    const ang = -span / 2 + span * (k / segments);
    const ri = r * (1 - thickness);
    pts.push({ x: Math.cos(ang) * ri + r * thickness * 0.6, y: Math.sin(ang) * ri });
  }
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return pts.map((p) => ({ x: centre.x + p.x * cos - p.y * sin, y: centre.y + p.x * sin + p.y * cos }));
}

/** A five-point star of outer radius `r`. */
function star(centre: Pt, r: number, rot: number): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k < 10; k += 1) {
    const rad = k % 2 === 0 ? r : r * 0.45;
    const ang = rot + (k / 10) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: centre.x + Math.cos(ang) * rad, y: centre.y + Math.sin(ang) * rad });
  }
  return pts;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
