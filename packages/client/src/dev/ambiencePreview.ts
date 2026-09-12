/**
 * 12.04 — Dev-only ambience preview (`dev/ambience.html`, not a build input): one fighter on the real stage with the
 * real `Lighting`, `Effects`, `ItemFx` and `SpriteFighter`, playing any action in isolation at 1× or 0.25×, with a
 * frame counter. A second stand-in is the target for hits. The sim is fabricated here (one tick per render frame at
 * 1×, one per four at 0.25×) so the driver can `seek` a laser to any charge frame deterministically. No drawing
 * logic lives here: every pixel comes from the modules under test.
 */
import Phaser from "phaser";
import {
  ARSENAL, BALANCE, CHARACTERS, MATCH, THROW, WORLD, createMatch,
  type CharacterId, type FighterState, type MatchState, type PlayerIndex, type SimEvent,
} from "@midnight/shared";
import { ROOF_INDEX, createBackgrounds, scrollBackgrounds, type Layers } from "../game/backgrounds";
import { Effects } from "../game/effects";
import { ItemFx, type HandPoint } from "../game/itemFx";
import { CSS_P } from "../game/palette";
import { drawShadow } from "../game/rig/draw";
import { computePose, laserHands, type Clock, type Joints } from "../game/rig/pose";
import { SpriteFighter } from "../game/sprites/SpriteFighter";
import { Lighting } from "../game/stage/lighting";

export type PreviewAction = "punch" | "sword" | "laser" | "throw" | "jump" | "block" | "shield" | "flash" | "hit" | "ko" | "walk" | "idle";
const ACTIONS: readonly PreviewAction[] = ["punch", "sword", "laser", "throw", "jump", "block", "shield", "flash", "hit", "ko", "walk", "idle"];

interface AmbienceDriver {
  play(action: PreviewAction, character?: CharacterId, speed?: 1 | 0.25): void;
  /** Jump to an action frame (punch/sword/laser: `elapsed`; throw: 0..CHARGE_MAX−1 charge, then release elapsed). */
  seek(frame: number): void;
  step(n?: number): void;
  pause(on?: boolean): boolean;
  frame(): number;
  state(): FighterState;
}
declare global { interface Window { __ambience: AmbienceDriver } }

const ACTOR_X = 400;
const TARGET_X = 560;
const KEYS: Record<string, PreviewAction> = {
  Digit1: "punch", Digit2: "sword", Digit3: "laser", Digit4: "throw", Digit5: "jump", Digit6: "block",
  Digit7: "shield", Digit8: "flash", Digit9: "hit", Digit0: "ko", KeyW: "walk",
};

class AmbiencePreviewScene extends Phaser.Scene {
  private layers!: Layers;
  private lighting!: Lighting;
  private effects!: Effects;
  private itemFx!: ItemFx;
  private sprites!: [SpriteFighter, SpriteFighter];
  private shadow!: Phaser.GameObjects.Graphics;
  private label!: Phaser.GameObjects.Text;
  private readonly state: MatchState = createMatch();
  private readonly pending: SimEvent[] = [];
  private readonly hands: HandPoint[] = [];
  private action: PreviewAction = "idle";
  private character: CharacterId = CHARACTERS[0]!;
  private speed: 1 | 0.25 = 1;
  private paused = false;
  private stepsQueued = 0;
  private frameAcc = 0;
  private actionFrame = 0;
  private actionTotal = 0;

  constructor() {
    super("ambience-preview");
    this.state.phase = "FIGHTING";
    this.state.phaseTicks = 0;
    this.state.fighters[0]!.x = ACTOR_X;
    this.state.fighters[1]!.x = TARGET_X;
    this.state.fighters[1]!.facing = -1;
  }

  create(): void {
    this.layers = createBackgrounds(this, "roof");
    this.lighting = new Lighting(this);
    this.lighting.setQuality(this.renderer.type === Phaser.WEBGL);
    this.effects = new Effects(this, this.lighting);
    this.itemFx = new ItemFx(this, this.lighting);
    this.shadow = this.add.graphics().setDepth(1);
    this.sprites = [new SpriteFighter(this, 0, 2.4), new SpriteFighter(this, 1, 2)];
    this.label = this.add.text(12, 12, "", {
      fontFamily: "ui-monospace, Menlo, monospace", fontSize: "12px", color: CSS_P.bone, stroke: CSS_P.outline, strokeThickness: 2,
    }).setDepth(10);
    window.__ambience = {
      play: (action, character, speed) => this.play(action, character, speed),
      seek: (frame) => this.seek(frame),
      step: (n = 1) => { this.paused = true; this.stepsQueued += Math.max(1, Math.floor(n)); },
      pause: (on) => { this.paused = on ?? !this.paused; return this.paused; },
      frame: () => this.actionFrame,
      state: () => structuredClone(this.state.fighters[0]!),
    };
    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
      const act = KEYS[e.code];
      if (act) this.play(act);
      if (e.code === "KeyC") this.play(this.action, CHARACTERS[(CHARACTERS.indexOf(this.character) + 1) % CHARACTERS.length]);
      if (e.code === "KeyS") this.speed = this.speed === 1 ? 0.25 : 1;
      if (e.code === "Space") this.paused = !this.paused;
      if (e.code === "Period") { this.paused = true; this.stepsQueued += 1; }
    });
    this.play("idle");
  }

  // ---- driver ----

  private reset(): void {
    const s = this.state;
    s.phase = "FIGHTING";
    s.phaseTicks = 0;
    s.winner = null;
    for (const [i, f] of s.fighters.entries()) {
      Object.assign(f, {
        x: i === 0 ? ACTOR_X : TARGET_X, y: WORLD.ROOF_Y, vx: 0, vy: 0, facing: i === 0 ? 1 : -1, grounded: true, jumpTicks: 0,
        hp: BALANCE.MAX_HP, action: null, hitstun: 0, knockbackVx: 0, blocking: false, item: null, laserCooldown: 0, dazzle: 0,
      });
    }
    this.pending.length = 0;
    this.actionFrame = 0;
  }

  private play(action: PreviewAction, character = this.character, speed = this.speed): void {
    this.reset();
    this.action = action;
    this.character = character;
    this.speed = speed;
    this.paused = false;
    const f = this.state.fighters[0]!;
    f.character = character;
    switch (action) {
      case "punch":
      case "sword":
        if (action === "sword") f.item = { kind: "sword", uses: 6 };
        f.action = { kind: "punch", arm: "R", elapsed: 0, landed: false, sword: action === "sword" };
        this.actionTotal = BALANCE.PUNCH_STARTUP + BALANCE.PUNCH_ACTIVE + BALANCE.PUNCH_RECOVERY;
        this.pending.push({ type: "PUNCH", player: 0, arm: "R" } as SimEvent);
        break;
      case "laser":
        f.action = { kind: "laser", elapsed: 0, hit: [] };
        this.actionTotal = ARSENAL.LASER_CHARGE + ARSENAL.LASER_ACTIVE + ARSENAL.LASER_RECOVERY;
        this.pending.push({ type: "LASER_CHARGE", player: 0 });
        break;
      case "throw":
        f.item = { kind: "molotov", uses: 2 };
        f.action = { kind: "throw", item: "molotov", arm: "R", phase: "charge", charge: 0, elapsed: 0, released: false };
        this.actionTotal = THROW.CHARGE_MAX + THROW.RELEASE_TICKS + THROW.RECOVERY;
        break;
      case "jump":
        f.grounded = false;
        f.vy = BALANCE.JUMP_VELOCITY;
        this.actionTotal = 0;
        this.pending.push({ type: "JUMP", player: 0 });
        break;
      case "block":
        f.blocking = true;
        this.actionTotal = 0;
        break;
      case "shield":
        f.item = { kind: "shield", uses: 3 };
        f.blocking = true;
        this.actionTotal = 0;
        break;
      case "flash":
        f.item = { kind: "flash", uses: 1 };
        this.actionTotal = 0;
        this.pending.push({ type: "FLASH", player: 0 });
        break;
      case "hit":
        f.hitstun = BALANCE.HITSTUN_TICKS;
        f.hp -= BALANCE.PUNCH_DAMAGE;
        this.actionTotal = BALANCE.HITSTUN_TICKS;
        this.pending.push({ type: "HIT", attacker: 1, target: 0, damage: BALANCE.PUNCH_DAMAGE, blocked: false });
        break;
      case "ko":
        f.hp = 0;
        this.state.phase = "ROUND_END";
        this.state.phaseTicks = MATCH.ROUND_END_TICKS;
        this.state.winner = 1;
        this.actionTotal = 0;
        this.pending.push({ type: "ROUND_END", round: 1, winner: 1 } as SimEvent);
        break;
      case "walk":
        f.vx = BALANCE.WALK_SPEED;
        this.actionTotal = 0;
        break;
      default:
        this.actionTotal = 0;
    }
  }

  private seek(frame: number): void {
    const f = this.state.fighters[0]!;
    const a = f.action;
    this.paused = true;
    if (!a) return;
    const target = Math.max(0, Math.floor(frame));
    if (a.kind === "throw") {
      if (target < THROW.CHARGE_MAX) { a.phase = "charge"; a.charge = target; a.elapsed = 0; a.released = false; }
      else { a.phase = "release"; a.charge = THROW.CHARGE_MAX; a.elapsed = target - THROW.CHARGE_MAX; a.released = a.elapsed >= THROW.RELEASE_TICKS; }
    } else {
      // replay the events the sim would have fired on the way (the laser's ring and beam)
      if (a.kind === "laser") {
        this.itemFx.destroy();
        this.itemFx = new ItemFx(this, this.lighting);
        this.pending.push({ type: "LASER_CHARGE", player: 0 });
        if (target >= ARSENAL.LASER_CHARGE) this.pending.push({ type: "LASER_FIRE", player: 0 });
      }
      a.elapsed = target;
    }
    this.actionFrame = target;
  }

  // ---- fabricated sim: one tick ----

  private tick(): void {
    const s = this.state;
    s.tick += 1;
    const f = s.fighters[0]!;
    const a = f.action;
    if (a?.kind === "punch") {
      a.elapsed += 1;
      if (a.elapsed >= this.actionTotal) f.action = null;
    } else if (a?.kind === "laser") {
      a.elapsed += 1;
      if (a.elapsed === ARSENAL.LASER_CHARGE) this.pending.push({ type: "LASER_FIRE", player: 0 });
      if (a.elapsed >= this.actionTotal) f.action = null;
    } else if (a?.kind === "throw") {
      if (a.phase === "charge") {
        a.charge += 1;
        if (a.charge >= THROW.CHARGE_MAX) { a.phase = "release"; a.elapsed = 0; }
      } else {
        a.elapsed += 1;
        if (a.elapsed === THROW.RELEASE_TICKS && !a.released) { a.released = true; if (f.item) f.item = f.item.uses > 1 ? { ...f.item, uses: f.item.uses - 1 } : null; this.pending.push({ type: "ITEM_USE", player: 0, item: "molotov" }); }
        if (a.elapsed >= THROW.RELEASE_TICKS + THROW.RECOVERY) f.action = null;
      }
    }
    if (f.hitstun > 0) f.hitstun -= 1;
    if (this.action === "walk") f.x = Math.min(WORLD.WIDTH - 60, f.x + f.vx);
    if (!f.grounded) {
      f.jumpTicks += 1;
      f.y += f.vy;
      f.vy += BALANCE.GRAVITY;
      if (f.y >= WORLD.ROOF_Y) { f.y = WORLD.ROOF_Y; f.vy = 0; f.grounded = true; f.jumpTicks = 0; }
    }
    this.actionFrame = a ? (a.kind === "throw" ? (a.phase === "charge" ? a.charge : THROW.CHARGE_MAX + a.elapsed) : a.elapsed) : this.actionFrame + 1;
  }

  update(time: number, delta: number): void {
    const dt = delta / 1000;
    scrollBackgrounds(this.layers, dt);
    this.lighting.update(dt, { roof: this.layers.tiles[ROOF_INDEX]?.tilePositionX ?? 0, tunnel: this.layers.tunnel.tilePositionX }, { reducedMotion: false, rays: true });

    let ticks = 0;
    if (this.stepsQueued > 0) { ticks = this.stepsQueued; this.stepsQueued = 0; }
    else if (!this.paused) {
      this.frameAcc += this.speed;
      while (this.frameAcc >= 1) { this.frameAcc -= 1; ticks += 1; }
    }
    for (let k = 0; k < ticks; k += 1) this.tick();

    const s = this.state;
    const hands = (i: PlayerIndex): HandPoint => this.hands[i] ?? { x: s.fighters[i]!.x + 14, y: s.fighters[i]!.y - 63 };
    const events = this.pending.splice(0);
    this.effects.consume(events, s);
    this.itemFx.consume(events, s, hands);

    this.shadow.clear();
    for (const i of [0, 1] as const) {
      const f = this.effects.frozen(i) ?? s.fighters[i]!;
      const clock: Clock = {
        renderMs: time, koFrames: this.effects.koFrames(i), landFrames: this.effects.landFrames(i),
        beat: this.effects.flashBeat(i) > 0 ? { kind: "flash", frames: this.effects.flashBeat(i) } : undefined,
      };
      const joints: Joints = computePose(f, clock);
      const rim = this.lighting.rimFor(f.x, f.y - 42);
      const fill = this.effects.fillFor(i);
      drawShadow(this.shadow, f.x, WORLD.ROOF_Y, Math.max(0, WORLD.ROOF_Y - f.y));
      this.sprites[i].update(f, joints, {
        rimColor: rim.color, rimSide: rim.side, gloom: rim.gloom, flash: fill.fillOverride, flashAlpha: fill.fillAlpha,
        squash: this.effects.squashFor(i), itemVisible: !this.itemFx.materialising(i), blinkMs: time,
      });
      this.hands[i] = f.action?.kind === "laser" ? laserHands(joints) : this.sprites[i].hand();
      if (joints.punchingArm && f.action?.kind === "punch" && f.action.elapsed >= BALANCE.PUNCH_STARTUP && f.action.elapsed < BALANCE.PUNCH_STARTUP + BALANCE.PUNCH_ACTIVE) {
        const arm = joints.arms[joints.punchingArm];
        this.effects.drawTrail(i, arm.shoulder, arm.fist);
      }
    }
    this.itemFx.draw(s, hands, 0);
    this.effects.update(dt);
    this.itemFx.update(dt);
    this.label.setText(`${this.action}  ${this.character}  frame ${this.actionFrame}${this.actionTotal ? `/${this.actionTotal}` : ""}  ${this.speed}×${this.paused ? "  paused" : ""}  update lights ${this.lighting.lights().length}`);
  }
}

const fpsTarget = Math.max(1, Math.min(60, Number(new URLSearchParams(location.search).get("fps")) || 60));
new Phaser.Game({
  type: Phaser.AUTO,
  width: WORLD.WIDTH,
  height: WORLD.HEIGHT,
  parent: "ambience",
  backgroundColor: CSS_P.night0,
  fps: { target: fpsTarget, forceSetTimeOut: fpsTarget < 60 },
  render: { roundPixels: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [AmbiencePreviewScene],
});
void ACTIONS;
