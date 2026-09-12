import { WORLD, type ItemId, type MatchState, type SimEvent } from "@midnight/shared";

/**
 * 9.06 — every sound in the game synthesised at runtime from oscillators and filtered noise. No audio files, no
 * `fetch`, no `<audio>`. Recipes are data (`Sfx.RECIPES`): pure functions of a context, an output node and a start
 * time that schedule nodes and return their duration, so a test with a fake context can inspect them and the dev
 * page (`dev/sfx.html`) can render them offline and dump what was scheduled.
 *
 * Wiring (`M` mute toggle, `consume` each frame, fire-loop start/stop from the hazard list) is 11.05's job.
 */

export type SfxName =
  | "equip_molotov" | "equip_sword" | "equip_shield" | "equip_banana" | "equip_flash"
  | "laser_charge" | "laser_fire" | "laser_hit"
  | "slash" | "parry" | "shield_absorb" | "shield_break"
  | "molotov_throw" | "fire_ignite" | "fire_loop_start" | "fire_loop_stop" | "peel_throw" | "slip" | "flash"
  | "punch_whiff" | "hit" | "block" | "jump" | "land" | "ko" | "round_start" | "round_end" | "match_end"
  | "pit_fall" | "ui_move" | "ui_select" | "countdown_tick";

/** Schedules nodes on `ctx` into `out` starting at `t0`; returns the sound's duration in seconds. */
export type Recipe = (ctx: BaseAudioContext, out: AudioNode, t0: number) => number;

export const MASTER_GAIN = 0.6;
export const MAX_VOICES = 24;
export const MUTE_KEY = "midnight-mayhem:muted";
const FIRE_FADE = 0.3;
/** A looping recipe returns this so the voice bookkeeping treats it as "live until stopped". */
const LOOP_DURATION = 60 * 60;

// ---- Deterministic noise: a seeded LCG, one shared buffer per context ----

const NOISE_SECONDS = 1;
/** Keyed by the destination node so a `trackSources` wrapper shares its context's buffer. */
const noiseBuffers = new WeakMap<AudioNode, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx.destination);
  if (cached) return cached;
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  noiseBuffers.set(ctx.destination, buffer);
  return buffer;
}

/**
 * A view of `ctx` that records every scheduled source (oscillators and buffer sources) into `into`, so a caller can
 * stop a recipe's sources early (the fire loop, an evicted voice) or dump what a recipe scheduled (the dev page).
 */
export function trackSources(ctx: BaseAudioContext, into: AudioScheduledSourceNode[]): BaseAudioContext {
  return new Proxy(ctx, {
    get(target, prop, _receiver) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;
      const fn = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => {
        const result = fn.apply(target, args);
        if (prop === "createOscillator" || prop === "createBufferSource") into.push(result as AudioScheduledSourceNode);
        return result;
      };
    },
  });
}

// ---- Building blocks ----

const MIN = 0.0005;

interface Env { peak: number; attack?: number | undefined; hold?: number | undefined }

/** A gain with an attack → (hold) → exponential release envelope, connected to `out`. */
function envelope(ctx: BaseAudioContext, out: AudioNode, t0: number, dur: number, env: Env): GainNode {
  const g = ctx.createGain();
  const attack = env.attack ?? 0.005;
  const hold = env.hold ?? 0;
  g.gain.setValueAtTime(MIN, t0);
  g.gain.linearRampToValueAtTime(env.peak, t0 + attack);
  if (hold > 0) g.gain.setValueAtTime(env.peak, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(MIN, t0 + Math.max(dur, attack + hold + 0.001));
  g.connect(out);
  return g;
}

interface ToneOpts {
  type: OscillatorType;
  f0: number;
  /** Glide target; reached at `t0 + (glide ?? dur)`. */
  f1?: number;
  glide?: number;
  dur: number;
  peak: number;
  attack?: number;
  hold?: number;
  detune?: number;
}

function tone(ctx: BaseAudioContext, out: AudioNode, t0: number, o: ToneOpts): OscillatorNode {
  const g = envelope(ctx, out, t0, o.dur, { peak: o.peak, attack: o.attack, hold: o.hold });
  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.f0, t0);
  if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + (o.glide ?? o.dur));
  if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
  osc.connect(g);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.02);
  return osc;
}

interface NoiseOpts {
  dur: number;
  peak: number;
  attack?: number;
  hold?: number;
  filter?: BiquadFilterType;
  f0?: number;
  f1?: number;
  q?: number;
  loop?: boolean;
}

/** Filtered noise burst. Returns the source and the envelope gain (so an LFO can modulate it). */
function noise(ctx: BaseAudioContext, out: AudioNode, t0: number, o: NoiseOpts): { src: AudioBufferSourceNode; env: GainNode } {
  const env = envelope(ctx, out, t0, o.dur, { peak: o.peak, attack: o.attack, hold: o.hold });
  let into: AudioNode = env;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.f0 ?? 1000, t0);
    if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur);
    if (o.q !== undefined) f.Q.setValueAtTime(o.q, t0);
    f.connect(env);
    into = f;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = o.loop ?? true;
  src.connect(into);
  src.start(t0);
  src.stop(t0 + o.dur + 0.02);
  return { src, env };
}

/** Sine LFO wired into an AudioParam (tremolo when aimed at a gain, vibrato at a frequency). */
function lfo(ctx: BaseAudioContext, target: AudioParam, t0: number, dur: number, hz: number, depth: number, type: OscillatorType = "sine"): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, t0);
  const amount = ctx.createGain();
  amount.gain.setValueAtTime(depth, t0);
  osc.connect(amount);
  amount.connect(target);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** A bell: three inharmonic sine partials with staggered decays. */
function bell(ctx: BaseAudioContext, out: AudioNode, t0: number, f: number, dur: number, peak: number): void {
  tone(ctx, out, t0, { type: "sine", f0: f, dur, peak, attack: 0.004 });
  tone(ctx, out, t0, { type: "sine", f0: f * 2.0, dur: dur * 0.7, peak: peak * 0.45, attack: 0.004 });
  tone(ctx, out, t0, { type: "sine", f0: f * 3.01, dur: dur * 0.4, peak: peak * 0.25, attack: 0.004 });
}

const NOTE = { C4: 261.63, E4: 329.63, G4: 392.0, A4: 440.0, B4: 493.88 } as const;
const ARP_NOTE = 0.09;
const ARP_STEPS = [0, 4, 7]; // root, major third, fifth
const TEXTURE_AT = 2 * ARP_NOTE; // the texture starts under the third note so the whole motif fits in 1.4 s

/** The equip signature: a rising three-note square arpeggio then the item's texture. */
function equip(base: number, texture: (ctx: BaseAudioContext, out: AudioNode, t: number) => number): Recipe {
  return (ctx, out, t0) => {
    ARP_STEPS.forEach((semis, i) => {
      tone(ctx, out, t0 + i * ARP_NOTE, {
        type: "square", f0: base * Math.pow(2, semis / 12), dur: ARP_NOTE, peak: 0.16, attack: 0.004, hold: 0.05,
      });
    });
    const textureDur = texture(ctx, out, t0 + TEXTURE_AT);
    return Math.max(ARP_STEPS.length * ARP_NOTE, TEXTURE_AT + textureDur);
  };
}

// ---- The recipes ----

const RECIPES: Record<SfxName, Recipe> = {
  // 1. Equip motifs
  equip_molotov: equip(NOTE.E4, (ctx, out, t) => {
    // Liquid slosh: low-passed noise with a 6 Hz tremolo.
    const { env } = noise(ctx, out, t, { dur: 0.7, peak: 0.35, attack: 0.02, hold: 0.3, filter: "lowpass", f0: 700, f1: 300, q: 2 });
    lfo(ctx, env.gain, t, 0.7, 6, 0.3);
    tone(ctx, out, t, { type: "sine", f0: 180, f1: 90, dur: 0.35, peak: 0.2 });
    return 0.7;
  }),
  equip_sword: equip(NOTE.A4, (ctx, out, t) => {
    // Metallic ring: two detuned triangles, 1.2 s decay.
    tone(ctx, out, t, { type: "triangle", f0: 1760, dur: 1.2, peak: 0.22, attack: 0.003 });
    tone(ctx, out, t, { type: "triangle", f0: 1760, detune: 18, dur: 1.2, peak: 0.18, attack: 0.003 });
    noise(ctx, out, t, { dur: 0.06, peak: 0.25, filter: "highpass", f0: 4000 });
    return 1.2;
  }),
  equip_shield: equip(NOTE.C4, (ctx, out, t) => {
    // Deep thunk: sine sweep 120 → 60 Hz.
    tone(ctx, out, t, { type: "sine", f0: 120, f1: 60, dur: 0.45, peak: 0.6, attack: 0.004 });
    noise(ctx, out, t, { dur: 0.08, peak: 0.2, filter: "lowpass", f0: 400 });
    return 0.45;
  }),
  equip_banana: equip(NOTE.G4, (ctx, out, t) => {
    // Comedic slide whistle: sawtooth glide up 400 → 900 Hz.
    const osc = tone(ctx, out, t, { type: "sawtooth", f0: 400, f1: 900, glide: 0.45, dur: 0.6, peak: 0.16, attack: 0.02, hold: 0.4 });
    lfo(ctx, osc.frequency, t, 0.6, 7, 12);
    return 0.6;
  }),
  equip_flash: equip(NOTE.B4, (ctx, out, t) => {
    // Camera charge whine: sine 2 kHz → 4 kHz over 300 ms, then a little click.
    tone(ctx, out, t, { type: "sine", f0: 2000, f1: 4000, glide: 0.3, dur: 0.4, peak: 0.18, attack: 0.01, hold: 0.3 });
    tone(ctx, out, t + 0.32, { type: "square", f0: 1500, dur: 0.03, peak: 0.12 });
    return 0.4;
  }),

  // 2. Laser
  laser_charge: (ctx, out, t0) => {
    const dur = 0.5;
    tone(ctx, out, t0, { type: "sine", f0: 200, f1: 900, dur, peak: 0.3, attack: 0.3, hold: 0.15 });
    noise(ctx, out, t0, { dur, peak: 0.25, attack: 0.4, hold: 0.05, filter: "bandpass", f0: 600, f1: 3000, q: 1.5 });
    return dur;
  },
  laser_fire: (ctx, out, t0) => {
    // A sawtooth chord under a fast low-pass sweep, then a noise tail.
    const chord = 0.25;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(6000, t0);
    lp.frequency.exponentialRampToValueAtTime(150, t0 + chord);
    lp.Q.setValueAtTime(4, t0);
    lp.connect(out);
    for (const f of [110, 164.8, 220]) tone(ctx, lp, t0, { type: "sawtooth", f0: f, dur: chord, peak: 0.3, attack: 0.003, hold: 0.1 });
    noise(ctx, out, t0 + 0.1, { dur: 0.4, peak: 0.28, attack: 0.02, filter: "lowpass", f0: 2500, f1: 300 });
    return 0.5;
  },
  laser_hit: (ctx, out, t0) => {
    noise(ctx, out, t0, { dur: 0.09, peak: 0.45, filter: "lowpass", f0: 1500, f1: 300 });
    tone(ctx, out, t0, { type: "square", f0: 90, f1: 40, dur: 0.1, peak: 0.3 });
    return 0.1;
  },

  // Sword and shield
  slash: (ctx, out, t0) => {
    noise(ctx, out, t0, { dur: 0.18, peak: 0.8, attack: 0.02, filter: "bandpass", f0: 3000, f1: 700, q: 1 });
    tone(ctx, out, t0, { type: "triangle", f0: 1400, f1: 300, dur: 0.16, peak: 0.12, attack: 0.01 });
    return 0.18;
  },
  parry: (ctx, out, t0) => {
    // Clang: inharmonic pair with a click transient.
    noise(ctx, out, t0, { dur: 0.03, peak: 0.4, filter: "highpass", f0: 3000 });
    tone(ctx, out, t0, { type: "triangle", f0: 2400, dur: 0.4, peak: 0.25, attack: 0.002 });
    tone(ctx, out, t0, { type: "square", f0: 3611, dur: 0.25, peak: 0.08, attack: 0.002 });
    tone(ctx, out, t0, { type: "triangle", f0: 1215, dur: 0.35, peak: 0.12, attack: 0.002 });
    return 0.4;
  },
  shield_absorb: (ctx, out, t0) => {
    tone(ctx, out, t0, { type: "sine", f0: 160, f1: 70, dur: 0.2, peak: 0.55 });
    noise(ctx, out, t0, { dur: 0.08, peak: 0.2, filter: "lowpass", f0: 500 });
    return 0.2;
  },
  shield_break: (ctx, out, t0) => {
    noise(ctx, out, t0, { dur: 0.14, peak: 0.45, filter: "highpass", f0: 1500 });
    [600, 450, 300].forEach((f, i) => tone(ctx, out, t0 + 0.06 * i, { type: "triangle", f0: f, f1: f * 0.7, dur: 0.22, peak: 0.2 }));
    tone(ctx, out, t0, { type: "sine", f0: 120, f1: 50, dur: 0.3, peak: 0.4 });
    return 0.4;
  },

  // Throwables and traps
  molotov_throw: (ctx, out, t0) => {
    noise(ctx, out, t0, { dur: 0.3, peak: 0.9, attack: 0.08, filter: "bandpass", f0: 400, f1: 2500, q: 0.8 });
    return 0.3;
  },
  fire_ignite: (ctx, out, t0) => {
    noise(ctx, out, t0, { dur: 0.45, peak: 0.5, attack: 0.01, hold: 0.05, filter: "lowpass", f0: 1800, f1: 350 });
    tone(ctx, out, t0, { type: "sine", f0: 90, f1: 45, dur: 0.25, peak: 0.45 });
    return 0.45;
  },
  fire_loop_start: (ctx, out, t0) => {
    // Looping crackle: band-passed noise whose amplitude flickers under two mismatched LFOs (random-ish, no Math.random).
    const { env } = noise(ctx, out, t0, { dur: LOOP_DURATION, peak: 0.22, attack: 0.15, hold: LOOP_DURATION, filter: "bandpass", f0: 1100, q: 0.7, loop: true });
    lfo(ctx, env.gain, t0, LOOP_DURATION, 7.3, 0.1, "square");
    lfo(ctx, env.gain, t0, LOOP_DURATION, 11.9, 0.07, "sawtooth");
    const { env: low } = noise(ctx, out, t0, { dur: LOOP_DURATION, peak: 0.12, attack: 0.3, hold: LOOP_DURATION, filter: "lowpass", f0: 250, loop: true });
    lfo(ctx, low.gain, t0, LOOP_DURATION, 2.1, 0.06);
    return LOOP_DURATION;
  },
  fire_loop_stop: (ctx, out, t0) => {
    // The last embers: a short crackle that dies over the fade time; `Sfx.play` fades the loop itself.
    noise(ctx, out, t0, { dur: FIRE_FADE, peak: 0.4, attack: 0.01, filter: "bandpass", f0: 1100, f1: 400, q: 0.8 });
    return FIRE_FADE;
  },
  peel_throw: (ctx, out, t0) => {
    noise(ctx, out, t0, { dur: 0.15, peak: 0.5, attack: 0.03, filter: "bandpass", f0: 900, f1: 2200, q: 0.8 });
    tone(ctx, out, t0, { type: "sine", f0: 700, f1: 300, dur: 0.12, peak: 0.12 });
    return 0.15;
  },
  slip: (ctx, out, t0) => {
    // Boing: a triangle dropping an octave and a half with a wobble.
    const osc = tone(ctx, out, t0, { type: "triangle", f0: 520, f1: 110, glide: 0.3, dur: 0.38, peak: 0.28, attack: 0.005, hold: 0.1 });
    lfo(ctx, osc.frequency, t0, 0.38, 18, 40);
    return 0.38;
  },
  flash: (ctx, out, t0) => {
    noise(ctx, out, t0, { dur: 0.05, peak: 0.6, filter: "highpass", f0: 2500 });
    tone(ctx, out, t0, { type: "sine", f0: 3000, f1: 250, dur: 0.06, peak: 0.4 });
    tone(ctx, out, t0 + 0.03, { type: "sine", f0: 4200, dur: 0.25, peak: 0.08, attack: 0.02 });
    return 0.28;
  },

  // 4. Existing feel
  punch_whiff: (ctx, out, t0) => {
    noise(ctx, out, t0, { dur: 0.12, peak: 0.8, attack: 0.02, filter: "bandpass", f0: 1200, f1: 300, q: 0.8 });
    return 0.12;
  },
  hit: (ctx, out, t0) => {
    noise(ctx, out, t0, { dur: 0.06, peak: 0.5, filter: "lowpass", f0: 2500 });
    tone(ctx, out, t0, { type: "sine", f0: 120, f1: 60, dur: 0.12, peak: 0.6 });
    return 0.12;
  },
  block: (ctx, out, t0) => {
    tone(ctx, out, t0, { type: "square", f0: 900, f1: 500, dur: 0.035, peak: 0.2 });
    noise(ctx, out, t0, { dur: 0.03, peak: 0.25, filter: "lowpass", f0: 1800 });
    return 0.05;
  },
  jump: (ctx, out, t0) => {
    tone(ctx, out, t0, { type: "sine", f0: 300, f1: 900, dur: 0.12, peak: 0.25, attack: 0.01, hold: 0.04 });
    return 0.12;
  },
  land: (ctx, out, t0) => {
    tone(ctx, out, t0, { type: "sine", f0: 100, f1: 45, dur: 0.15, peak: 0.5 });
    noise(ctx, out, t0, { dur: 0.05, peak: 0.2, filter: "lowpass", f0: 600 });
    return 0.15;
  },
  ko: (ctx, out, t0) => {
    const notes = [440, 370, 311, 220];
    notes.forEach((f, i) => {
      const last = i === notes.length - 1;
      tone(ctx, out, t0 + i * 0.18, { type: "square", f0: f, dur: last ? 0.45 : 0.17, peak: 0.16, attack: 0.005, hold: last ? 0.2 : 0.1 });
    });
    tone(ctx, out, t0 + 0.54, { type: "sine", f0: 110, f1: 55, dur: 0.45, peak: 0.3 });
    return 1.0;
  },
  round_start: (ctx, out, t0) => {
    bell(ctx, out, t0, 880, 1.0, 0.35);
    return 1.0;
  },
  round_end: (ctx, out, t0) => {
    [523.25, 659.25, 783.99].forEach((f, i) => bell(ctx, out, t0 + i * 0.05, f, 1.2, 0.22));
    return 1.3;
  },
  match_end: (ctx, out, t0) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(ctx, out, t0 + i * 0.12, f, 1.8, 0.22));
    return 2.2;
  },
  pit_fall: (ctx, out, t0) => {
    const osc = tone(ctx, out, t0, { type: "sine", f0: 1400, f1: 180, glide: 0.7, dur: 0.75, peak: 0.25, attack: 0.02, hold: 0.5 });
    lfo(ctx, osc.frequency, t0, 0.75, 6, 30);
    return 0.75;
  },
  ui_move: (ctx, out, t0) => {
    tone(ctx, out, t0, { type: "square", f0: 1200, dur: 0.025, peak: 0.22, attack: 0.002 });
    return 0.03;
  },
  ui_select: (ctx, out, t0) => {
    tone(ctx, out, t0, { type: "square", f0: 900, dur: 0.03, peak: 0.22, attack: 0.002 });
    tone(ctx, out, t0 + 0.05, { type: "square", f0: 1400, dur: 0.04, peak: 0.22, attack: 0.002 });
    return 0.09;
  },
  countdown_tick: (ctx, out, t0) => {
    tone(ctx, out, t0, { type: "sine", f0: 1000, dur: 0.08, peak: 0.3, attack: 0.003 });
    return 0.08;
  },
};

// ---- The player ----

interface Voice { out: GainNode; end: number; sources: AudioScheduledSourceNode[] }

function readMuted(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* private mode or no storage: the in-memory flag still works */
  }
}

function makeContext(): AudioContext | null {
  try {
    const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

export class Sfx {
  static readonly RECIPES: Record<SfxName, Recipe> = RECIPES;

  private ctx: AudioContext | null;
  private master: GainNode | null = null;
  private readonly voices: Voice[] = [];
  private fireLoop: Voice | null = null;
  /** The arena wants the fire loop running (set even while muted, so unmuting can bring it back). */
  private fireWanted = false;
  private _muted = readMuted();
  /** True once a context creation was attempted and failed; play() stays a no-op from then on. */
  private unavailable = false;

  /** Lazy: without `ctx`, the context is created on the first play() (which should follow a user gesture). */
  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? null;
  }

  get muted(): boolean {
    return this._muted;
  }

  /** Voices currently live (the fire loop is tracked separately and not counted). */
  get voiceCount(): number {
    this.prune();
    return this.voices.length;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    writeMuted(muted);
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setValueAtTime(muted ? 0 : MASTER_GAIN, this.ctx.currentTime);
      this.master.gain.value = muted ? 0 : MASTER_GAIN;
    }
    if (muted) this.stopFireLoop(0);
    // The arena only calls fire_loop_start on a fire edge; a fire that is still burning after unmuting restarts here.
    else if (this.fireWanted && !this.fireLoop) this.play("fire_loop_start");
  }

  play(name: SfxName, opts?: { pan?: number; gain?: number }): void {
    if (name === "fire_loop_start") this.fireWanted = true;
    else if (name === "fire_loop_stop") this.fireWanted = false;
    if (this._muted) return;
    if (name === "fire_loop_start" && this.fireLoop) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    try {
      const t0 = ctx.currentTime;
      if (name === "fire_loop_stop") this.stopFireLoop(FIRE_FADE);
      const out = ctx.createGain();
      out.gain.value = opts?.gain ?? 1;
      let sink: AudioNode = this.master;
      if (typeof ctx.createStereoPanner === "function") {
        const panner = ctx.createStereoPanner();
        panner.pan.value = clamp(opts?.pan ?? 0, -1, 1);
        panner.connect(this.master);
        sink = panner;
      }
      out.connect(sink);
      const sources: AudioScheduledSourceNode[] = [];
      const duration = Sfx.RECIPES[name](trackSources(ctx, sources), out, t0);
      const voice: Voice = { out, end: t0 + duration + 0.05, sources };
      if (name === "fire_loop_start") {
        this.fireLoop = voice;
        return;
      }
      this.prune();
      while (this.voices.length >= MAX_VOICES) stopVoice(this.voices.shift()!, t0);
      this.voices.push(voice);
    } catch {
      /* a broken or closed context must never take the game down */
    }
  }

  /** Map sim events to sounds; pan from the fighter's x / WORLD.WIDTH. */
  consume(events: SimEvent[], state: MatchState): void {
    const panOf = (player: number): number => {
      const f = state.fighters[player];
      return f ? clamp((f.x / WORLD.WIDTH) * 2 - 1, -1, 1) : 0;
    };
    for (const e of events) {
      switch (e.type) {
        case "ITEM_EQUIP": this.play(EQUIP_SOUND[e.item], { pan: panOf(e.player) }); break;
        case "LASER_CHARGE": this.play("laser_charge", { pan: panOf(e.player) }); break;
        case "LASER_FIRE": this.play("laser_fire", { pan: panOf(e.player) }); break;
        case "LASER_HIT": this.play("laser_hit", { pan: panOf(e.target) }); break;
        case "PARRY": this.play("parry", { pan: panOf(e.player) }); break;
        case "SHIELD_ABSORB": this.play("shield_absorb", { pan: panOf(e.player) }); break;
        case "ITEM_BREAK": if (e.item === "shield") this.play("shield_break", { pan: panOf(e.player) }); break;
        case "ITEM_USE": if (e.item === "sword") this.play("slash", { pan: panOf(e.player) }); break;
        case "PROJECTILE_SPAWN": this.play(e.kind === "molotov" ? "molotov_throw" : "peel_throw", { pan: panOf(e.owner) }); break;
        case "HAZARD_SPAWN": if (e.kind === "fire") this.play("fire_ignite", { pan: clamp((e.x / WORLD.WIDTH) * 2 - 1, -1, 1) }); break;
        case "HAZARD_HIT": if (e.damage === 0) this.play("slip", { pan: panOf(e.target) }); break;
        case "FLASH": this.play("flash", { pan: panOf(e.player) }); break;
        case "HIT": this.play(e.blocked ? "block" : "hit", { pan: panOf(e.target) }); break;
        case "JUMP": this.play("jump", { pan: panOf(e.player) }); break;
        case "LAND": this.play("land", { pan: panOf(e.player) }); break;
        case "ROUND_START": this.play("round_start"); break;
        case "ROUND_END": {
          const down = state.fighters.findIndex((f) => f.hp <= 0);
          if (down >= 0) this.play("ko", { pan: panOf(down) });
          this.play("round_end");
          break;
        }
        case "MATCH_END": this.play("match_end"); break;
        case "PIT_FALL": this.play("pit_fall", { pan: panOf(e.player) }); break;
        case "PUNCH": this.play("punch_whiff", { pan: panOf(e.player) }); break;
        default: break;
      }
    }
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      if (this.unavailable) return null;
      this.ctx = makeContext();
      if (!this.ctx) {
        this.unavailable = true;
        return null;
      }
    }
    const ctx = this.ctx;
    try {
      if (ctx.state === "suspended" && typeof ctx.resume === "function") void ctx.resume().catch(() => undefined);
    } catch {
      /* ignore */
    }
    if (!this.master) {
      try {
        this.master = ctx.createGain();
        this.master.gain.value = this._muted ? 0 : MASTER_GAIN;
        this.master.connect(ctx.destination);
      } catch {
        this.master = null;
        return null;
      }
    }
    return ctx;
  }

  private prune(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    let keep = 0;
    for (const v of this.voices) if (v.end > now) this.voices[keep++] = v;
    this.voices.length = keep;
  }

  private stopFireLoop(fade: number): void {
    const loop = this.fireLoop;
    if (!loop || !this.ctx) return;
    this.fireLoop = null;
    try {
      const now = this.ctx.currentTime;
      loop.out.gain.cancelScheduledValues(now);
      loop.out.gain.setValueAtTime(loop.out.gain.value, now);
      loop.out.gain.linearRampToValueAtTime(0, now + fade);
      for (const src of loop.sources) src.stop(now + fade);
    } catch {
      /* ignore */
    }
  }
}

/** Silence an evicted voice now: stop its sources (not just its gain) so they stop costing CPU. */
function stopVoice(voice: Voice, now: number): void {
  for (const src of voice.sources) {
    try {
      src.stop(now);
    } catch {
      /* already stopped or never started */
    }
  }
  voice.out.disconnect();
}

const EQUIP_SOUND: Record<ItemId, SfxName> = {
  molotov: "equip_molotov", sword: "equip_sword", shield: "equip_shield", banana: "equip_banana", flash: "equip_flash",
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
