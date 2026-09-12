import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORLD, createMatch, type MatchState, type SimEvent } from "@midnight/shared";
import { MAX_VOICES, Sfx, type SfxName } from "../src/game/sfx";

// ---- Minimal fake BaseAudioContext: records created nodes and start/stop times ----

class FakeParam {
  value = 0;
  automation: Array<{ op: string; value: number; time: number }> = [];
  setValueAtTime(value: number, time: number): this { this.automation.push({ op: "set", value, time }); return this; }
  linearRampToValueAtTime(value: number, time: number): this { this.automation.push({ op: "lin", value, time }); return this; }
  exponentialRampToValueAtTime(value: number, time: number): this { this.automation.push({ op: "exp", value, time }); return this; }
  setTargetAtTime(value: number, time: number, _tc: number): this { this.automation.push({ op: "target", value, time }); return this; }
  cancelScheduledValues(_time: number): this { return this; }
}

class FakeNode {
  readonly connections: unknown[] = [];
  disconnected = false;
  constructor(readonly kind: string) {}
  connect(target: unknown): unknown { this.connections.push(target); return target; }
  disconnect(): void { this.disconnected = true; }
}

class FakeGain extends FakeNode { gain = new FakeParam(); constructor() { super("gain"); } }
class FakePanner extends FakeNode { pan = new FakeParam(); constructor() { super("panner"); } }
class FakeFilter extends FakeNode {
  type = "lowpass"; frequency = new FakeParam(); Q = new FakeParam();
  constructor() { super("filter"); }
}
class FakeSource extends FakeNode {
  constructor(kind: "oscillator" | "buffer") { super(kind); }
  started: number | null = null;
  stopped: number | null = null;
  type = "sine";
  loop = false;
  buffer: unknown = null;
  frequency = new FakeParam();
  detune = new FakeParam();
  playbackRate = new FakeParam();
  start(when = 0): void { this.started = when; }
  stop(when = 0): void { this.stopped = when; }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 48_000;
  state = "running";
  readonly destination = new FakeNode("destination");
  readonly nodes: FakeNode[] = [];
  private make<T extends FakeNode>(node: T): T { this.nodes.push(node); return node; }
  createGain(): FakeGain { return this.make(new FakeGain()); }
  createStereoPanner(): FakePanner { return this.make(new FakePanner()); }
  createBiquadFilter(): FakeFilter { return this.make(new FakeFilter()); }
  createOscillator(): FakeSource { return this.make(new FakeSource("oscillator")); }
  createBufferSource(): FakeSource { return this.make(new FakeSource("buffer")); }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: () => data };
  }
  get sources(): FakeSource[] { return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource); }
}

function ctxAndSfx(): { ctx: FakeContext; sfx: Sfx } {
  const ctx = new FakeContext();
  const sfx = new Sfx(ctx as unknown as AudioContext);
  return { ctx, sfx };
}

const NAMES = Object.keys(Sfx.RECIPES) as SfxName[];
const EQUIPS: SfxName[] = ["equip_molotov", "equip_sword", "equip_shield", "equip_banana", "equip_flash"];

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

beforeEach(() => { vi.stubGlobal("localStorage", fakeStorage()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Sfx.RECIPES", () => {
  it("has a recipe for every SfxName that schedules at least one node and returns a duration > 0", () => {
    expect(NAMES.length).toBe(32);
    for (const name of NAMES) {
      const ctx = new FakeContext();
      const out = ctx.createGain();
      const before = ctx.nodes.length;
      const duration = Sfx.RECIPES[name](ctx as unknown as BaseAudioContext, out as unknown as AudioNode, 1.5);
      expect(duration, name).toBeGreaterThan(0);
      expect(ctx.nodes.length, name).toBeGreaterThan(before);
      const started = ctx.sources.filter((s) => s.started !== null);
      expect(started.length, `${name} starts a source`).toBeGreaterThanOrEqual(1);
      for (const s of started) expect(s.started!, `${name} starts at or after t0`).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("equip sounds are a two-part motif of three square notes plus a texture, at most 1.4 s long", () => {
    for (const name of EQUIPS) {
      const ctx = new FakeContext();
      const out = ctx.createGain();
      const duration = Sfx.RECIPES[name](ctx as unknown as BaseAudioContext, out as unknown as AudioNode, 0);
      expect(duration, name).toBeLessThanOrEqual(1.4);
      const squares = ctx.sources.filter((s) => s.type === "square" && s.started !== null);
      expect(squares.length, `${name} arpeggio`).toBeGreaterThanOrEqual(3);
      const starts = squares.map((s) => s.started!).sort((a, b) => a - b);
      expect(starts[1]! - starts[0]!).toBeCloseTo(0.09, 3);
      expect(starts[2]! - starts[1]!).toBeCloseTo(0.09, 3);
      // Something other than the three arpeggio notes: the item's texture.
      expect(ctx.sources.length, `${name} texture`).toBeGreaterThan(3);
    }
  });

  it("equip cue (9.08 rule 4): a 60 ms noise snap first, then the motif at +6 dB, within 1.4 s", () => {
    for (const name of EQUIPS) {
      const ctx = new FakeContext();
      const out = ctx.createGain();
      const t0 = 2;
      const duration = Sfx.RECIPES[name](ctx as unknown as BaseAudioContext, out as unknown as AudioNode, t0);
      expect(duration, name).toBeLessThanOrEqual(1.4);
      const started = ctx.sources.filter((s) => s.started !== null).sort((a, b) => a.started! - b.started!);
      const snap = started[0]!;
      expect(snap.kind, `${name} snap is noise`).toBe("buffer");
      expect(snap.started).toBeCloseTo(t0, 5);
      expect(snap.stopped! - snap.started!, `${name} snap ~60 ms`).toBeCloseTo(0.08, 2);
      const squares = ctx.sources.filter((s) => s.type === "square" && s.started !== null).sort((a, b) => a.started! - b.started!);
      expect(squares[0]!.started!, `${name} motif follows the snap`).toBeCloseTo(t0 + 0.06, 5);
      for (const s of started) if (s !== snap) expect(s.started!).toBeGreaterThanOrEqual(t0 + 0.06 - 1e-9);
      // The motif routes through a +6 dB (x2) boost gain that feeds `out`; the snap goes straight to `out`.
      const boost = ctx.nodes.find((n): n is FakeGain => n instanceof FakeGain && n.connections.includes(out)
        && n.gain.automation.some((a) => a.op === "set" && Math.abs(a.value - 2) < 1e-9));
      expect(boost, `${name} boost gain`).toBeDefined();
    }
  });

  it("equip arpeggios start on the item's base note", () => {
    const base: Record<string, number> = { equip_molotov: 329.63, equip_sword: 440, equip_shield: 261.63, equip_banana: 392, equip_flash: 493.88 };
    for (const name of EQUIPS) {
      const ctx = new FakeContext();
      Sfx.RECIPES[name](ctx as unknown as BaseAudioContext, ctx.createGain() as unknown as AudioNode, 0);
      const first = ctx.sources.filter((s) => s.type === "square").sort((a, b) => a.started! - b.started!)[0]!;
      expect(first.frequency.automation[0]!.value).toBeCloseTo(base[name]!, 1);
    }
  });

  it("is deterministic given t0 (no Math.random)", () => {
    const spy = vi.spyOn(Math, "random");
    for (const name of NAMES) {
      const a = new FakeContext();
      const b = new FakeContext();
      Sfx.RECIPES[name](a as unknown as BaseAudioContext, a.createGain() as unknown as AudioNode, 2);
      Sfx.RECIPES[name](b as unknown as BaseAudioContext, b.createGain() as unknown as AudioNode, 2);
      const dump = (c: FakeContext) => JSON.stringify(c.sources.map((s) => [s.type, s.started, s.stopped, s.frequency.automation]));
      expect(dump(a)).toBe(dump(b));
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("laser_fire is a 0.25 s sawtooth chord under a low-pass sweep with a noise tail ending near 0.5 s", () => {
    const ctx = new FakeContext();
    const t0 = 1;
    const duration = Sfx.RECIPES.laser_fire(ctx as unknown as BaseAudioContext, ctx.createGain() as unknown as AudioNode, t0);
    const saws = ctx.sources.filter((s) => s.type === "sawtooth");
    expect(saws.length).toBeGreaterThanOrEqual(3);
    for (const s of saws) expect(s.stopped! - t0).toBeCloseTo(0.27, 2);
    const filters = ctx.nodes.filter((n): n is FakeFilter => n instanceof FakeFilter && n.type === "lowpass");
    const sweep = filters.find((f) => f.frequency.automation.some((a) => a.op === "exp" && a.time - t0 <= 0.25));
    expect(sweep, "fast low-pass sweep").toBeDefined();
    const tail = ctx.sources.filter((s) => s.kind === "buffer");
    expect(tail.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...tail.map((s) => s.stopped! - s.started!))).toBeCloseTo(0.42, 2);
    expect(duration).toBeCloseTo(0.5, 3);
  });

  it("ko is a descending four-note line", () => {
    const ctx = new FakeContext();
    Sfx.RECIPES.ko(ctx as unknown as BaseAudioContext, ctx.createGain() as unknown as AudioNode, 0);
    const notes = ctx.sources.filter((s) => s.type === "square").sort((a, b) => a.started! - b.started!);
    expect(notes.length).toBe(4);
    const freqs = notes.map((n) => n.frequency.automation[0]!.value);
    for (let i = 1; i < 4; i++) expect(freqs[i]!, `note ${i} lower`).toBeLessThan(freqs[i - 1]!);
    for (let i = 1; i < 4; i++) expect(notes[i]!.started!, `note ${i} later`).toBeGreaterThan(notes[i - 1]!.started!);
  });

  it("laser_charge lasts 0.5 s and fire_loop_start loops", () => {
    const ctx = new FakeContext();
    expect(Sfx.RECIPES.laser_charge(ctx as unknown as BaseAudioContext, ctx.createGain() as unknown as AudioNode, 0)).toBeCloseTo(0.5, 3);
    const loopCtx = new FakeContext();
    Sfx.RECIPES.fire_loop_start(loopCtx as unknown as BaseAudioContext, loopCtx.createGain() as unknown as AudioNode, 0);
    expect(loopCtx.sources.some((s) => s.loop)).toBe(true);
  });
});

describe("Sfx.play", () => {
  it("routes each voice through a gain and a panner into a 0.6 master", () => {
    const { ctx, sfx } = ctxAndSfx();
    sfx.play("hit", { pan: -0.5, gain: 0.8 });
    const master = ctx.nodes.find((n) => n instanceof FakeGain && n.connections.includes(ctx.destination)) as FakeGain;
    expect(master).toBeDefined();
    expect(master.gain.value).toBeCloseTo(0.6);
    const panner = ctx.nodes.find((n): n is FakePanner => n instanceof FakePanner)!;
    expect(panner.pan.value).toBeCloseTo(-0.5);
    expect(panner.connections).toContain(master);
    const voice = ctx.nodes.find((n): n is FakeGain => n instanceof FakeGain && n.connections.includes(panner))!;
    expect(voice.gain.value).toBeCloseTo(0.8);
    expect(ctx.sources.length).toBeGreaterThan(0);
  });

  it("clamps pan to -1..1", () => {
    const { ctx, sfx } = ctxAndSfx();
    sfx.play("hit", { pan: 4 });
    const panner = ctx.nodes.find((n): n is FakePanner => n instanceof FakePanner)!;
    expect(panner.pan.value).toBe(1);
  });

  it("keeps at most 24 voices live and drops the oldest first", () => {
    const { ctx, sfx } = ctxAndSfx();
    const voices: FakeGain[] = [];
    for (let i = 0; i < 30; i++) {
      const before = ctx.nodes.length;
      sfx.play("ui_move");
      const voice = ctx.nodes.slice(before).find((n): n is FakeGain => n instanceof FakeGain && n.connections.some((c) => c instanceof FakePanner))!;
      voices.push(voice);
    }
    expect(sfx.voiceCount).toBe(24);
    for (let i = 0; i < 6; i++) expect(voices[i]!.disconnected, `voice ${i} dropped`).toBe(true);
    for (let i = 6; i < 30; i++) expect(voices[i]!.disconnected, `voice ${i} kept`).toBe(false);
  });

  it("stops an evicted voice's sources at the current time, not just its gain", () => {
    const { ctx, sfx } = ctxAndSfx();
    sfx.play("round_start"); // long enough to still be live when evicted
    const first = ctx.sources.slice();
    expect(first.length).toBeGreaterThan(0);
    for (const s of first) expect(s.stopped).toBeGreaterThan(0.2);
    ctx.currentTime = 0.2;
    for (let i = 0; i < MAX_VOICES; i++) sfx.play("ui_move");
    for (const s of first) expect(s.stopped, "evicted source stopped now").toBeCloseTo(0.2, 6);
  });

  it("frees voices once their duration has elapsed", () => {
    const { ctx, sfx } = ctxAndSfx();
    sfx.play("ui_move");
    expect(sfx.voiceCount).toBe(1);
    ctx.currentTime = 10;
    sfx.play("ui_move");
    expect(sfx.voiceCount).toBe(1);
  });

  it("fire loop: start once, stop fades over 0.3 s", () => {
    const { ctx, sfx } = ctxAndSfx();
    sfx.play("fire_loop_start");
    const count = ctx.nodes.length;
    sfx.play("fire_loop_start");
    expect(ctx.nodes.length).toBe(count);
    const loop = ctx.sources.find((s) => s.loop)!;
    expect(loop.stopped).toBeGreaterThan(60); // only the recipe's safety stop, far in the future
    ctx.currentTime = 2;
    sfx.play("fire_loop_stop");
    expect(loop.stopped).toBeCloseTo(2.3, 3);
    // The fire loop is not counted against the voice cap.
    expect(sfx.voiceCount).toBe(1);
    // A second stop is harmless; a later start runs again.
    sfx.play("fire_loop_stop");
    const before = ctx.nodes.length;
    sfx.play("fire_loop_start");
    expect(ctx.nodes.length).toBeGreaterThan(before);
  });
});

describe("Sfx mute", () => {
  it("muted sets the master gain to 0 and schedules nothing", () => {
    const { ctx, sfx } = ctxAndSfx();
    sfx.play("hit");
    const master = ctx.nodes.find((n) => n instanceof FakeGain && n.connections.includes(ctx.destination)) as FakeGain;
    sfx.setMuted(true);
    expect(sfx.muted).toBe(true);
    expect(master.gain.value).toBe(0);
    const before = ctx.nodes.length;
    sfx.play("hit");
    sfx.play("fire_loop_start");
    expect(ctx.nodes.length).toBe(before);
    sfx.setMuted(false);
    expect(master.gain.value).toBeCloseTo(0.6);
    sfx.play("hit");
    expect(ctx.nodes.length).toBeGreaterThan(before);
  });

  it("unmuting while a fire still burns brings the fire loop back; a loop started while muted starts on unmute", () => {
    const { ctx, sfx } = ctxAndSfx();
    // A live fire loop source only carries the recipe's far-off safety stop; stopping it schedules a near stop.
    const live = () => ctx.sources.filter((s) => s.loop && (s.stopped ?? 0) > 60);
    sfx.play("fire_loop_start");
    const perLoop = live().length;
    expect(perLoop).toBeGreaterThan(0);
    ctx.currentTime = 1;
    sfx.setMuted(true);
    expect(live()).toHaveLength(0);
    sfx.setMuted(false);
    expect(live()).toHaveLength(perLoop);
    // Stop clears the wish: unmute after a stop starts nothing.
    sfx.play("fire_loop_stop");
    expect(live()).toHaveLength(0);
    sfx.setMuted(true); sfx.setMuted(false);
    expect(live()).toHaveLength(0);
    // Started while muted: nothing scheduled until unmute.
    sfx.setMuted(true);
    sfx.play("fire_loop_start");
    expect(live()).toHaveLength(0);
    sfx.setMuted(false);
    expect(live()).toHaveLength(perLoop);
  });

  it("persists mute in localStorage['midnight-mayhem:muted']", () => {
    const { sfx } = ctxAndSfx();
    sfx.setMuted(true);
    expect(localStorage.getItem("midnight-mayhem:muted")).toBe("1");
    const again = new Sfx(new FakeContext() as unknown as AudioContext);
    expect(again.muted).toBe(true);
    again.setMuted(false);
    expect(localStorage.getItem("midnight-mayhem:muted")).toBe("0");
  });
});

describe("Sfx without AudioContext", () => {
  it("never throws: play is a no-op and consume still returns", () => {
    vi.stubGlobal("AudioContext", undefined);
    const sfx = new Sfx();
    expect(() => sfx.play("hit")).not.toThrow();
    expect(() => sfx.consume([{ type: "JUMP", player: 0 }], createMatch())).not.toThrow();
    expect(() => sfx.setMuted(true)).not.toThrow();
    expect(sfx.voiceCount).toBe(0);
  });

  it("creates the context lazily on the first play", () => {
    const made: FakeContext[] = [];
    vi.stubGlobal("AudioContext", class extends FakeContext { constructor() { super(); made.push(this); } });
    const sfx = new Sfx();
    expect(made.length).toBe(0);
    sfx.play("jump");
    expect(made.length).toBe(1);
    expect(made[0]!.sources.length).toBeGreaterThan(0);
  });
});

describe("Sfx.consume", () => {
  function setup(): { sfx: Sfx; state: MatchState; played: Array<[SfxName, number | undefined]> } {
    const { sfx } = ctxAndSfx();
    const state = createMatch();
    const played: Array<[SfxName, number | undefined]> = [];
    vi.spyOn(sfx, "play").mockImplementation((name, opts) => { played.push([name, opts?.pan]); });
    return { sfx, state, played };
  }

  const cases: Array<[SimEvent, SfxName[]]> = [
    [{ type: "ITEM_EQUIP", player: 0, item: "molotov" }, ["equip_molotov"]],
    [{ type: "ITEM_EQUIP", player: 0, item: "sword" }, ["equip_sword"]],
    [{ type: "ITEM_EQUIP", player: 0, item: "shield" }, ["equip_shield"]],
    [{ type: "ITEM_EQUIP", player: 0, item: "banana" }, ["equip_banana"]],
    [{ type: "ITEM_EQUIP", player: 0, item: "flash" }, ["equip_flash"]],
    [{ type: "LASER_CHARGE", player: 1 }, ["laser_charge"]],
    [{ type: "LASER_FIRE", player: 1 }, ["laser_fire"]],
    [{ type: "LASER_HIT", attacker: 0, target: 1, damage: 8, blocked: false }, ["laser_hit"]],
    [{ type: "PARRY", player: 0, attacker: 1 }, ["parry"]],
    [{ type: "SHIELD_ABSORB", player: 0, left: 2 }, ["shield_absorb"]],
    [{ type: "ITEM_BREAK", player: 0, item: "shield" }, ["shield_break"]],
    [{ type: "ITEM_BREAK", player: 0, item: "sword" }, []],
    [{ type: "ITEM_USE", player: 0, item: "sword" }, ["slash"]],
    [{ type: "ITEM_USE", player: 0, item: "shield" }, []],
    [{ type: "PROJECTILE_SPAWN", id: 1, kind: "molotov", owner: 0 }, ["molotov_throw"]],
    [{ type: "PROJECTILE_SPAWN", id: 2, kind: "banana", owner: 0 }, ["peel_throw"]],
    [{ type: "HAZARD_SPAWN", id: 3, kind: "fire", x: 100 }, ["fire_ignite"]],
    [{ type: "HAZARD_SPAWN", id: 4, kind: "peel", x: 100 }, []],
    [{ type: "HAZARD_HIT", id: 4, kind: "peel", target: 1, damage: 0 }, ["slip"]],
    [{ type: "HAZARD_HIT", id: 3, kind: "fire", target: 1, damage: 2 }, []],
    [{ type: "FLASH", player: 0 }, ["flash"]],
    [{ type: "HIT", attacker: 0, target: 1, damage: 12, blocked: false }, ["hit"]],
    [{ type: "HIT", attacker: 0, target: 1, damage: 3, blocked: true }, ["block"]],
    [{ type: "JUMP", player: 0 }, ["jump"]],
    [{ type: "LAND", player: 0 }, ["land"]],
    [{ type: "ROUND_START", round: 1 }, ["round_start"]],
    [{ type: "ROUND_END", round: 1, winner: 0 }, ["round_end"]],
    [{ type: "MATCH_END", winner: 0 }, ["match_end"]],
    [{ type: "PIT_FALL", player: 1 }, ["pit_fall"]],
    [{ type: "PUNCH", player: 0, arm: "L" }, ["punch_whiff"]],
    [{ type: "OOB_DAMAGE", player: 0, damage: 3 }, []],
    [{ type: "PIT_RESPAWN", player: 0 }, []],
  ];

  for (const [event, expected] of cases) {
    it(`${event.type}${"item" in event ? ` ${event.item}` : ""}${"kind" in event ? ` ${event.kind}` : ""}${"blocked" in event ? ` blocked=${event.blocked}` : ""}${"damage" in event && event.type === "HAZARD_HIT" ? ` damage=${event.damage}` : ""} → ${expected.join(",") || "nothing"}`, () => {
      const { sfx, state, played } = setup();
      sfx.consume([event], state);
      expect(played.map(([n]) => n)).toEqual(expected);
    });
  }

  it("ROUND_END with a fighter at 0 hp plays ko and round_end", () => {
    const { sfx, state, played } = setup();
    state.fighters[1]!.hp = 0;
    sfx.consume([{ type: "ROUND_END", round: 1, winner: 0 }], state);
    expect(played.map(([n]) => n)).toEqual(["ko", "round_end"]);
  });

  it("pans from the fighter's x over WORLD.WIDTH", () => {
    const { sfx, state, played } = setup();
    state.fighters[0]!.x = 0;
    state.fighters[1]!.x = WORLD.WIDTH;
    sfx.consume([
      { type: "JUMP", player: 0 },
      { type: "JUMP", player: 1 },
      { type: "HIT", attacker: 0, target: 1, damage: 12, blocked: false },
      { type: "HAZARD_SPAWN", id: 1, kind: "fire", x: WORLD.WIDTH / 2 },
      { type: "ROUND_START", round: 1 },
    ], state);
    expect(played[0]![1]).toBeCloseTo(-1);
    expect(played[1]![1]).toBeCloseTo(1);
    expect(played[2]![1]).toBeCloseTo(1); // the target's x
    expect(played[3]![1]).toBeCloseTo(0);
    expect(played[4]![1] ?? 0).toBeCloseTo(0);
  });

  it("handles a burst of many events in one call", () => {
    const { sfx, state, played } = setup();
    const events: SimEvent[] = [];
    for (let i = 0; i < 40; i++) events.push({ type: "PUNCH", player: 0, arm: "L" });
    sfx.consume(events, state);
    expect(played.length).toBe(40);
  });
});
