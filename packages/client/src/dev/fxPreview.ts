import Phaser from "phaser";
import { BALANCE, MATCH, WORLD, createMatch, type MatchState, type PlayerIndex, type SimEvent } from "@midnight/shared";
import { Effects } from "../game/effects";
import { P } from "../game/palette";

/**
 * Dev-only preview for 4.06 (`dev/fx.html`, not a build input). A night-1 fill, the roof line, two stand-in
 * rectangles at the spawn x positions and a real `Effects`. `window.__fx` fabricates `SimEvent`s and state
 * mutations for the screenshot driver; every visible effect is drawn by `Effects`, nothing here draws one.
 *
 * The fabricated sim advances one tick per render frame: walking, gravity, and the OOB damage cadence.
 */

interface FxDriver {
  /** Clean or blocked HIT on `target` from the other fighter. `damage` defaults to the punch or chip value. */
  hit(target: PlayerIndex, blocked?: boolean, damage?: number): void;
  /** JUMP event plus a real arc so the landing follows on its own. */
  jump(player: PlayerIndex): void;
  /** Force a landing on the next frame (grounded false → true). */
  land(player: PlayerIndex): void;
  /** Put the fighter on its own hard edge; OOB_DAMAGE then arrives every 30 ticks until it walks back in. */
  oob(player: PlayerIndex): void;
  /** ROUND_END with `loser` at 0 hp. Any later command revives both fighters. */
  ko(loser: PlayerIndex): void;
  /** Walk toward the opponent at WALK_SPEED for `ticks` ticks. */
  walk(player: PlayerIndex, ticks: number): void;
}

declare global {
  interface Window { __fx: FxDriver }
}

const TRAIL_FRAMES = 3;
const SHOULDER_ABOVE_FEET = 115;
const FIST_ABOVE_FEET = 100;

class FxPreviewScene extends Phaser.Scene {
  private readonly state: MatchState = createMatch();
  private readonly pending: SimEvent[] = [];
  private readonly nextFrame: Array<() => void> = [];
  private readonly walkTicks: [number, number] = [0, 0];
  private readonly trailFrames: [number, number] = [0, 0];
  private effects!: Effects;
  private rects!: [Phaser.GameObjects.Graphics, Phaser.GameObjects.Graphics];
  private label!: Phaser.GameObjects.Text;

  constructor() {
    super("fx-preview");
    this.state.phase = "FIGHTING";
    this.state.phaseTicks = 0;
  }

  create(): void {
    const stage = this.add.graphics().setDepth(0);
    stage.fillStyle(P.night1, 1);
    stage.fillRect(0, 0, WORLD.WIDTH, WORLD.HEIGHT);
    stage.lineStyle(3, P.steel2, 1);
    stage.lineBetween(0, WORLD.ROOF_Y, WORLD.WIDTH, WORLD.ROOF_Y);

    this.rects = [this.add.graphics().setDepth(2), this.add.graphics().setDepth(3)];
    this.effects = new Effects(this);
    this.label = this.add.text(12, WORLD.HEIGHT - 22, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#5B6375",
    }).setDepth(10);

    window.__fx = {
      hit: (target, blocked = false, damage) => this.hit(target, blocked, damage),
      jump: (player) => this.jump(player),
      land: (player) => this.land(player),
      oob: (player) => this.oob(player),
      ko: (loser) => this.ko(loser),
      walk: (player, ticks) => this.walk(player, ticks),
    };
  }

  update(_time: number, delta: number): void {
    const queued = this.nextFrame.splice(0);
    for (const fn of queued) fn();
    this.stepFabricatedSim();

    this.effects.consume(this.pending.splice(0), this.state);

    for (const i of [0, 1] as const) {
      const f = this.effects.frozen(i) ?? this.state.fighters[i];
      const squash = this.effects.squashFor(i);
      const fill = this.effects.fillFor(i);
      const w = WORLD.HURTBOX_W / squash;
      const h = WORLD.HURTBOX_H * squash;
      const g = this.rects[i];
      g.clear();
      g.fillStyle(i === 0 ? P.drifterKey : P.conductorKey, 1);
      g.fillRect(f.x - w / 2, f.y - h, w, h);
      if (fill.fillOverride !== undefined) {
        g.fillStyle(fill.fillOverride, fill.fillAlpha ?? 1);
        g.fillRect(f.x - w / 2, f.y - h, w, h);
      }
      g.lineStyle(3, P.outline, 1);
      g.strokeRect(f.x - w / 2, f.y - h, w, h);

      if (this.trailFrames[i] > 0) {
        this.trailFrames[i] -= 1;
        this.effects.drawTrail(
          i,
          { x: f.x - f.facing * 10, y: f.y - SHOULDER_ABOVE_FEET },
          { x: f.x + f.facing * (BALANCE.PUNCH_GAP + BALANCE.PUNCH_REACH / 2), y: f.y - FIST_ABOVE_FEET },
        );
      }
    }

    this.effects.update(delta / 1000);

    const s = this.state;
    this.label.setText(
      `tick ${s.tick}  ${s.phase}  hp ${s.fighters[0].hp}/${s.fighters[1].hp}  timeScale ${this.effects.timeScale()}` +
      `  ko ${this.effects.koFrames(0)}/${this.effects.koFrames(1)}` +
      `  land ${fmtLand(this.effects.landFrames(0))}/${fmtLand(this.effects.landFrames(1))}`,
    );
  }

  // ---- fabricated sim (one tick per render frame) ----

  private stepFabricatedSim(): void {
    const s = this.state;
    s.tick += 1;
    for (const i of [0, 1] as const) {
      const f = s.fighters[i];
      const other = s.fighters[i === 0 ? 1 : 0];
      if (other.x !== f.x) f.facing = other.x > f.x ? 1 : -1;

      if (this.walkTicks[i] > 0 && s.phase === "FIGHTING") {
        this.walkTicks[i] -= 1;
        f.vx = f.facing * BALANCE.WALK_SPEED;
        f.x = clamp(f.x + f.vx, 0, WORLD.WIDTH);
      } else {
        f.vx = 0;
      }

      if (!f.grounded) {
        f.jumpTicks += 1;
        f.y += f.vy;
        f.vy += BALANCE.GRAVITY;
        if (f.y >= WORLD.ROOF_Y) {
          f.y = WORLD.ROOF_Y;
          f.vy = 0;
          f.grounded = true;
          f.jumpTicks = 0;
        }
      }

      if (f.x <= 0 || f.x >= WORLD.WIDTH) {
        f.oobTicks += 1;
        if (f.oobTicks % BALANCE.OOB_EVERY_TICKS === 0) {
          f.hp = Math.max(0, f.hp - BALANCE.OOB_DAMAGE);
          this.pending.push({ type: "OOB_DAMAGE", player: i, damage: BALANCE.OOB_DAMAGE });
        }
      } else {
        f.oobTicks = 0;
      }
    }
  }

  /** After a KO the state sits in ROUND_END; pass through COUNTDOWN for one frame so Effects resets its KO state. */
  private ensureFighting(): void {
    const s = this.state;
    if (s.phase === "FIGHTING") return;
    s.phase = "COUNTDOWN";
    s.winner = null;
    for (const f of s.fighters) f.hp = BALANCE.MAX_HP;
    this.nextFrame.push(() => { s.phase = "FIGHTING"; s.phaseTicks = 0; });
  }

  private hit(target: PlayerIndex, blocked: boolean, damage?: number): void {
    this.ensureFighting();
    const attacker: PlayerIndex = target === 0 ? 1 : 0;
    const dmg = damage ?? (blocked ? BALANCE.CHIP_DAMAGE : BALANCE.PUNCH_DAMAGE);
    const f = this.state.fighters[target];
    f.hp = Math.max(0, f.hp - dmg);
    f.blocking = blocked;
    this.trailFrames[attacker] = TRAIL_FRAMES;
    this.pending.push({ type: "HIT", attacker, target, damage: dmg, blocked });
  }

  private jump(player: PlayerIndex): void {
    this.ensureFighting();
    const f = this.state.fighters[player];
    if (!f.grounded) return;
    f.grounded = false;
    f.vy = BALANCE.JUMP_VELOCITY;
    f.jumpTicks = 0;
    this.pending.push({ type: "JUMP", player });
  }

  private land(player: PlayerIndex): void {
    this.ensureFighting();
    const f = this.state.fighters[player];
    f.grounded = false;
    f.y = WORLD.ROOF_Y - 0.01;
    f.vy = 0; // airborne for one sampled frame, then gravity crosses ROOF_Y and lands
  }

  private oob(player: PlayerIndex): void {
    this.ensureFighting();
    const f = this.state.fighters[player];
    this.walkTicks[player] = 0;
    f.x = player === 0 ? 0 : WORLD.WIDTH;
    f.oobTicks = BALANCE.OOB_EVERY_TICKS - 1; // first OOB_DAMAGE on the next tick
  }

  private ko(loser: PlayerIndex): void {
    const s = this.state;
    const winner: PlayerIndex = loser === 0 ? 1 : 0;
    s.fighters[loser].hp = 0;
    s.phase = "ROUND_END";
    s.phaseTicks = MATCH.ROUND_END_TICKS;
    s.winner = winner;
    this.walkTicks[0] = this.walkTicks[1] = 0;
    this.pending.push({ type: "ROUND_END", round: s.round, winner });
  }

  private walk(player: PlayerIndex, ticks: number): void {
    this.ensureFighting();
    this.walkTicks[player] = Math.max(0, Math.floor(ticks));
  }
}

function fmtLand(n: number): string {
  return n >= 1_000_000 ? "-" : String(n);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// `?fps=10` slows the render loop so the driver can catch a 6-frame effect at its peak; effects count render
// frames, so a slow loop stretches them in wall time without changing what any frame looks like.
const fpsTarget = Math.max(1, Math.min(60, Number(new URLSearchParams(location.search).get("fps")) || 60));

new Phaser.Game({
  type: Phaser.AUTO,
  width: WORLD.WIDTH,
  height: WORLD.HEIGHT,
  parent: "fx",
  backgroundColor: "#070B18",
  fps: { target: fpsTarget, forceSetTimeOut: fpsTarget < 60 },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [FxPreviewScene],
});
