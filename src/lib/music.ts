"use client";

import { audioContext } from "@/lib/audio";

/**
 * Procedural chiptune soundtrack.
 *
 * An original 8-bar loop in A minor (i - VI - iv - V - i - VI - VII - V),
 * synthesised live: a triangle bass, a thin pulse arpeggio, a square lead,
 * noise hats and snare, and a pitched-down sine kick. Nothing ships as audio.
 *
 * Timing uses the classic lookahead scheduler: a 25ms interval wakes up and
 * books every 16th note that falls within the next 120ms against the audio
 * clock (ctx.currentTime), so the groove stays tight even when the main
 * thread is busy. There is never one timer per note.
 *
 * Signal path:  voices -> lowpass -> bus (master gain + fades) -> compressor -> out
 * The noise hats join at the bus, after the lowpass: it is there to take the
 * fizz off the square waves, and it would otherwise swallow the hats whole.
 *
 * Shares the SFX engine's AudioContext. Nothing touches `window` until
 * start() is called, and everything quietly no-ops without WebAudio.
 */

type Intensity = 0 | 1 | 2;
type Phase = "idle" | "playing" | "stopping";

/* ----------------------------------------------------------------- tuning */

const BPM = 118;
/** One 16th note, in seconds. */
const STEP = 60 / BPM / 4;
const STEPS_PER_BAR = 16;
const BARS = 8;
const LOOP = STEPS_PER_BAR * BARS;
/** How far ahead of the audio clock notes are booked. */
const LOOKAHEAD = 0.12;
/** How often the scheduler wakes up. */
const TICK_MS = 25;
const MASTER = 0.07;
/** Fade in / out, seconds. */
const FADE = 0.6;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/* --------------------------------------------------------------- the song */

/** [step within the bar, MIDI note, length in 16ths] */
type Note = readonly [number, number, number];

interface Bar {
  /** Bass root, octave 2. */
  root: number;
  /** Arpeggio chord tones, octave 4-5. */
  chord: readonly [number, number, number];
  /** Lead melody (action and up). */
  lead: readonly Note[];
  /** Counter-melody in half notes (finale only). */
  counter: readonly Note[];
}

// prettier-ignore
const SONG: readonly Bar[] = [
  // Am
  { root: 45, chord: [69, 72, 76],
    lead: [[0, 76, 3], [3, 81, 3], [6, 79, 2], [8, 76, 4], [12, 74, 2], [14, 76, 2]],
    counter: [[0, 60, 8], [8, 64, 8]] },
  // F
  { root: 41, chord: [65, 69, 72],
    lead: [[0, 72, 3], [3, 77, 3], [6, 76, 2], [8, 72, 6], [14, 69, 2]],
    counter: [[0, 69, 8], [8, 65, 8]] },
  // Dm
  { root: 38, chord: [62, 65, 69],
    lead: [[0, 74, 3], [3, 77, 3], [6, 81, 2], [8, 79, 2], [10, 77, 2], [12, 76, 2], [14, 74, 2]],
    counter: [[0, 65, 8], [8, 69, 8]] },
  // E (harmonic minor V)
  { root: 40, chord: [64, 68, 71],
    lead: [[0, 76, 4], [4, 74, 2], [6, 71, 2], [8, 68, 4], [12, 71, 2], [14, 76, 2]],
    counter: [[0, 68, 8], [8, 71, 8]] },
  // Am
  { root: 45, chord: [69, 72, 76],
    lead: [[0, 76, 3], [3, 81, 3], [6, 79, 2], [8, 76, 2], [10, 79, 2], [12, 81, 4]],
    counter: [[0, 69, 8], [8, 72, 8]] },
  // F
  { root: 41, chord: [65, 69, 72],
    lead: [[0, 84, 3], [3, 81, 3], [6, 77, 2], [8, 81, 4], [12, 79, 2], [14, 77, 2]],
    counter: [[0, 72, 8], [8, 69, 8]] },
  // G
  { root: 43, chord: [67, 71, 74],
    lead: [[0, 79, 3], [3, 74, 3], [6, 71, 2], [8, 74, 2], [10, 79, 2], [12, 77, 2], [14, 74, 2]],
    counter: [[0, 71, 8], [8, 74, 8]] },
  // E — walks back down into the top of the loop
  { root: 40, chord: [64, 68, 71],
    lead: [[0, 80, 3], [3, 83, 3], [6, 80, 2], [8, 76, 2], [10, 74, 2], [12, 71, 2], [14, 68, 2]],
    counter: [[0, 71, 8], [8, 68, 8]] },
];

/** Step -> [octave offset, length in 16ths]. */
type Pattern = Readonly<Record<number, readonly [number, number]>>;

/** Ambient: long, syncopated roots with an octave answer. */
const BASS_CALM: Pattern = { 0: [0, 5], 6: [12, 2], 8: [0, 5], 14: [12, 2] };
/** Action: driving octave bass with 16th pickups. */
// prettier-ignore
const BASS_DRIVE: Pattern = {
  0: [0, 2], 2: [12, 1], 3: [0, 1], 4: [0, 2], 6: [12, 2],
  8: [0, 2], 10: [12, 1], 11: [0, 1], 12: [0, 2], 14: [12, 2],
};

/** Melodies flattened to the loop's absolute step for O(1) lookup. */
function flatten(pick: (b: Bar) => readonly Note[]) {
  const out: (readonly [number, number] | null)[] = Array(LOOP).fill(null);
  SONG.forEach((bar, i) =>
    pick(bar).forEach(([at, midi, len]) => {
      out[i * STEPS_PER_BAR + at] = [midi, len];
    }),
  );
  return out;
}
const LEAD = flatten((b) => b.lead);
const COUNTER = flatten((b) => b.counter);

/* ------------------------------------------------------------------ state */

let phase: Phase = "idle";
let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
/** Every pitched voice plugs in here, in front of the bus. */
let lowpass: BiquadFilterNode | null = null;
let comp: DynamicsCompressorNode | null = null;
let hatBus: BiquadFilterNode | null = null;
let snareBus: BiquadFilterNode | null = null;

let timer: number | null = null;
let teardownTimer: number | null = null;
/** Every listener start() adds, removed in one abort(). */
let listeners: AbortController | null = null;

let step = 0;
let nextTime = 0;
let intensity: Intensity = 0;
let pending: Intensity = 0;

/** Sources still sounding, so teardown can cut them off. */
const voices = new Set<AudioScheduledSourceNode>();
/** Steps booked since the last start (dev diagnostics). */
let booked = 0;

/* ------------------------------------------------------------ instruments */

// Per-context caches. The site only ever has the one shared context.
let wavesFor: BaseAudioContext | null = null;
let pulse12: PeriodicWave | null = null;
let pulse25: PeriodicWave | null = null;
let noiseBuf: AudioBuffer | null = null;

/** NES-style pulse wave with the given duty cycle. */
function pulseWave(c: BaseAudioContext, duty: number) {
  const n = 40;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return c.createPeriodicWave(real, imag);
}

function prepare(c: AudioContext) {
  if (wavesFor === c) return;
  wavesFor = c;
  pulse12 = pulseWave(c, 0.125);
  pulse25 = pulseWave(c, 0.25);
  // One second of white noise, reused by every hat and snare from a random offset.
  noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

/** Disconnect a one-shot voice as soon as it has finished sounding. */
function track(src: AudioScheduledSourceNode, gain: GainNode) {
  voices.add(src);
  src.onended = () => {
    src.disconnect();
    gain.disconnect();
    voices.delete(src);
  };
}

interface ToneOpts {
  /** A built-in oscillator shape, or a custom wave (the pulse widths). */
  wave: Exclude<OscillatorType, "custom"> | { custom: PeriodicWave };
  peak: number;
  /** Attack, seconds. */
  attack?: number;
  /** Hold this fraction of the peak, then release at the end (sustained notes). */
  hold?: number;
  /** Start this many cents flat and slide up: a chiptune "scoop". */
  scoop?: number;
}

function tone(c: AudioContext, out: AudioNode, t: number, freq: number, dur: number, o: ToneOpts) {
  const osc = c.createOscillator();
  if (typeof o.wave === "string") osc.type = o.wave;
  else osc.setPeriodicWave(o.wave.custom);
  osc.frequency.setValueAtTime(freq, t);
  if (o.scoop) {
    osc.detune.setValueAtTime(-o.scoop, t);
    osc.detune.linearRampToValueAtTime(0, t + 0.04);
  }
  const g = c.createGain();
  const atk = o.attack ?? 0.004;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.peak, t + atk);
  if (o.hold) {
    g.gain.linearRampToValueAtTime(o.peak * o.hold, t + Math.max(atk + 0.01, dur * 0.7));
    g.gain.linearRampToValueAtTime(0, t + dur);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  track(osc, g);
}

function noiseHit(c: AudioContext, out: AudioNode, t: number, dur: number, peak: number) {
  if (!noiseBuf) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(g).connect(out);
  src.start(t, Math.random() * 0.8, dur + 0.02);
  track(src, g);
}

function kick(c: AudioContext, out: AudioNode, t: number, peak: number) {
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.26);
  track(osc, g);
}

function snare(c: AudioContext, t: number, peak: number) {
  if (!lowpass || !snareBus) return;
  noiseHit(c, snareBus, t, 0.13, peak);
  // a short pitched body under the noise
  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(190, t);
  osc.frequency.exponentialRampToValueAtTime(120, t + 0.07);
  const g = c.createGain();
  g.gain.setValueAtTime(peak * 0.6, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(g).connect(lowpass);
  osc.start(t);
  osc.stop(t + 0.11);
  track(osc, g);
}

/* -------------------------------------------------------------- sequencer */

/** Book everything that sounds on one 16th step. */
function play(c: AudioContext, s: number, t: number) {
  const out = lowpass;
  if (!out || !hatBus || !pulse12 || !pulse25) return;
  const p12 = { custom: pulse12 };
  const p25 = { custom: pulse25 };
  const bar = SONG[Math.floor(s / STEPS_PER_BAR)];
  const i = s % STEPS_PER_BAR;
  const lvl = intensity;
  const last = s >= LOOP - STEPS_PER_BAR;

  // Bass — triangle, plus a quiet pulse an octave up once things kick off.
  const b = (lvl === 0 ? BASS_CALM : BASS_DRIVE)[i];
  if (b) {
    const f = hz(bar.root + b[0]);
    const dur = b[1] * STEP * 0.92;
    tone(c, out, t, f, dur, { wave: "triangle", peak: 0.62, hold: 0.7 });
    if (lvl > 0) tone(c, out, t, f * 2, dur * 0.8, { wave: p25, peak: 0.07 });
  }

  // Arpeggio — 8ths and soft when calm, 16ths under the lead otherwise.
  if (lvl === 0) {
    if (i % 2 === 0) {
      const seq = [0, 1, 2, 1];
      const note = bar.chord[seq[(i / 2) % 4]];
      tone(c, out, t, hz(note), 0.14, { wave: p12, peak: 0.16 });
    }
  } else {
    const seq = [0, 1, 2, 3];
    const k = seq[i % 4];
    let note = k === 3 ? bar.chord[0] + 12 : bar.chord[k];
    // Finale: every other beat jumps up an octave.
    if (lvl === 2 && Math.floor(i / 4) % 2 === 1) note += 12;
    tone(c, out, t, hz(note), 0.075, { wave: p12, peak: lvl === 2 ? 0.1 : 0.12 });
  }

  // Lead melody.
  if (lvl > 0) {
    const n = LEAD[s];
    if (n) {
      const dur = n[1] * STEP * 0.9;
      tone(c, out, t, hz(n[0]), dur, { wave: "square", peak: 0.15, hold: 0.55, scoop: 35 });
      // Finale: a soft octave lift doubling the lead.
      if (lvl === 2) tone(c, out, t, hz(n[0] + 12), dur, { wave: "triangle", peak: 0.1, hold: 0.6 });
    }
  }

  // Counter-melody (finale only).
  if (lvl === 2) {
    const n = COUNTER[s];
    if (n) {
      tone(c, out, t, hz(n[0]), n[1] * STEP * 0.95, {
        wave: p25,
        peak: 0.09,
        attack: 0.03,
        hold: 0.75,
      });
    }
  }

  // Kick on the beat; the finale adds a push before beat 4.
  if (lvl > 0 && (i % 4 === 0 || (lvl === 2 && i === 10))) kick(c, out, t, 0.95);

  // Snare on 2 and 4, with a roll into the top of the loop in the finale.
  if (lvl > 0 && (i === 4 || i === 12)) snare(c, t, 0.34);
  if (lvl === 2 && last && (i === 13 || i === 14 || i === 15)) snare(c, t, 0.2 + (i - 13) * 0.06);

  // Hats — sparse off-beats when calm, 16ths with accents otherwise.
  if (lvl === 0) {
    if (i === 2 || i === 10) noiseHit(c, hatBus, t, 0.03, 0.11);
    else if (i === 6 || i === 14) noiseHit(c, hatBus, t, 0.025, 0.045);
  } else if (lvl === 2 && i === 14) {
    noiseHit(c, hatBus, t, 0.16, 0.09); // open hat
  } else {
    noiseHit(c, hatBus, t, 0.03, i % 4 === 2 ? 0.12 : 0.05);
  }
}

function tick() {
  const c = ctx;
  if (!c || c.state !== "running") return;
  const now = c.currentTime;

  // The main thread stalled (or a background tab was throttled): skip the
  // missed steps on the grid instead of firing them all at once.
  if (nextTime < now) {
    const missed = Math.ceil((now - nextTime) / STEP);
    if (Math.floor((step + missed) / STEPS_PER_BAR) !== Math.floor(step / STEPS_PER_BAR)) {
      intensity = pending;
    }
    nextTime += missed * STEP;
    step = (step + missed) % LOOP;
  }

  while (nextTime < now + LOOKAHEAD) {
    // Intensity changes land on the next bar line.
    if (step % STEPS_PER_BAR === 0) intensity = pending;
    play(c, step, nextTime);
    nextTime += STEP;
    step = (step + 1) % LOOP;
    booked++;
  }
}

/** Run the scheduler only while it can be heard: started, context running, tab visible. */
function sync() {
  const c = ctx;
  const run = phase !== "idle" && c !== null && c.state === "running" && !document.hidden;
  if (run && timer === null) {
    // (Re)start from the top of the current bar so a resume never lands mid-phrase.
    step -= step % STEPS_PER_BAR;
    intensity = pending;
    nextTime = c.currentTime + 0.05;
    timer = window.setInterval(tick, TICK_MS);
    tick();
  } else if (!run && timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

/* ------------------------------------------------------------------ graph */

function build(c: AudioContext) {
  prepare(c);

  comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.005;
  comp.release.value = 0.25;
  comp.connect(c.destination);

  bus = c.createGain();
  bus.gain.value = 0;
  bus.connect(comp);

  lowpass = c.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 5200;
  lowpass.Q.value = 0.5;
  lowpass.connect(bus);

  hatBus = c.createBiquadFilter();
  hatBus.type = "highpass";
  hatBus.frequency.value = 7000;
  hatBus.connect(bus);

  snareBus = c.createBiquadFilter();
  snareBus.type = "bandpass";
  snareBus.frequency.value = 1800;
  snareBus.Q.value = 0.8;
  snareBus.connect(bus);
}

function fadeTo(target: number) {
  if (!ctx || !bus) return;
  const g = bus.gain;
  const now = ctx.currentTime;
  if (typeof g.cancelAndHoldAtTime === "function") {
    g.cancelAndHoldAtTime(now);
  } else {
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
  }
  g.linearRampToValueAtTime(target, now + FADE);
}

function teardown() {
  teardownTimer = null;
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  listeners?.abort();
  listeners = null;
  // Cut anything still ringing (long notes, notes booked inside the lookahead);
  // each one disconnects itself in its onended handler.
  const now = ctx?.currentTime ?? 0;
  voices.forEach((v) => {
    try {
      v.stop(now);
    } catch {
      /* defensive: a source that cannot be stopped is just dropped */
      v.disconnect();
      voices.delete(v);
    }
  });
  for (const node of [hatBus, snareBus, lowpass, bus, comp]) node?.disconnect();
  hatBus = snareBus = lowpass = bus = comp = null;
  phase = "idle";
  step = 0;
}

/* -------------------------------------------------------------------- API */

export const music = {
  /** Start (or resume) the loop. Safe to call repeatedly. */
  start(): void {
    if (phase === "playing") return;
    const c = audioContext();
    if (!c) return;

    if (phase === "stopping" && bus) {
      // Caught mid fade-out: cancel the teardown and fade back in, groove intact.
      if (teardownTimer !== null) window.clearTimeout(teardownTimer);
      teardownTimer = null;
      phase = "playing";
      fadeTo(MASTER);
      return;
    }

    ctx = c;
    build(c);
    phase = "playing";
    step = 0;
    booked = 0;
    fadeTo(MASTER);

    listeners = new AbortController();
    const { signal } = listeners;
    document.addEventListener("visibilitychange", sync, { signal });
    c.addEventListener("statechange", sync, { signal });
    // Browsers keep audio suspended until a user gesture. If that has not
    // happened yet, the first click or key press wakes the context and the
    // statechange listener above starts the scheduler.
    const wake = () => {
      if (ctx && ctx.state !== "running" && ctx.state !== "closed") void ctx.resume();
    };
    window.addEventListener("pointerdown", wake, { capture: true, passive: true, signal });
    window.addEventListener("keydown", wake, { capture: true, passive: true, signal });

    sync();
  },

  /** Fade out and stop. Safe to call when not playing. */
  stop(): void {
    if (phase !== "playing") return;
    phase = "stopping";
    // Keep scheduling through the fade so it actually fades, then tear down.
    fadeTo(0);
    teardownTimer = window.setTimeout(teardown, FADE * 1000 + 120);
  },

  /** 0 = ambient, 1 = action (arcade fight), 2 = boss low on HP / finale. */
  setIntensity(level: 0 | 1 | 2): void {
    const next = Math.max(0, Math.min(2, Math.round(level))) as Intensity;
    pending = next;
    // Not scheduling right now: nothing to wait for, apply it straight away.
    if (timer === null) intensity = next;
  },

  isPlaying(): boolean {
    return phase === "playing";
  },
};

// Development only: drive the engine from devtools / Playwright.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
  w.__glitchMusic = music;
  w.__glitchMusicDebug = () => ({
    phase,
    intensity,
    pending,
    step,
    scheduling: timer !== null,
    voices: voices.size,
    booked,
    context: ctx?.state ?? null,
    /** Final node of the music graph, for attaching an analyser in tests. */
    output: comp,
  });
}
