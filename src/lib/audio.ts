"use client";

/**
 * Tiny procedural chiptune SFX engine.
 * No audio files ship with the site — every sound is synthesised on demand,
 * and nothing is created until the user explicitly turns sound on.
 */

type Voice = "square" | "triangle" | "sawtooth" | "sine";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = false;

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (on) ensure();
}

/**
 * The shared AudioContext, created on demand. The music engine uses this so
 * the site never runs two contexts. Only call it in response to a user
 * gesture (or after one) — browsers keep it suspended otherwise.
 */
export function audioContext(): AudioContext | null {
  return ensure();
}

export function isSoundEnabled() {
  return enabled;
}

interface ToneOpts {
  freq: number;
  to?: number;
  dur?: number;
  voice?: Voice;
  gain?: number;
  delay?: number;
}

function tone({
  freq,
  to,
  dur = 0.09,
  voice = "square",
  gain = 0.5,
  delay = 0,
}: ToneOpts) {
  const c = ensure();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = voice;
  osc.frequency.setValueAtTime(freq, t0);
  if (to && to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur = 0.16, gain = 0.35, delay = 0, freq = 1400) {
  const c = ensure();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  hover() {
    if (!enabled) return;
    tone({ freq: 880, dur: 0.035, voice: "square", gain: 0.12 });
  },
  select() {
    if (!enabled) return;
    tone({ freq: 523, to: 1046, dur: 0.1, gain: 0.4 });
    tone({ freq: 1318, dur: 0.12, gain: 0.3, delay: 0.08 });
  },
  coin() {
    if (!enabled) return;
    tone({ freq: 988, dur: 0.06, gain: 0.35 });
    tone({ freq: 1318, dur: 0.16, gain: 0.35, delay: 0.055 });
  },
  jump() {
    if (!enabled) return;
    tone({ freq: 320, to: 760, dur: 0.12, voice: "square", gain: 0.25 });
  },
  land() {
    if (!enabled) return;
    noise(0.07, 0.16);
  },
  swap() {
    if (!enabled) return;
    tone({ freq: 440, to: 620, dur: 0.06, voice: "triangle", gain: 0.25 });
  },
  match(combo = 0) {
    if (!enabled) return;
    const base = 523 * Math.pow(1.122, Math.min(combo, 8));
    tone({ freq: base, dur: 0.07, voice: "square", gain: 0.3 });
    tone({ freq: base * 1.5, dur: 0.09, gain: 0.26, delay: 0.05 });
  },
  hit() {
    if (!enabled) return;
    noise(0.2, 0.34);
    tone({ freq: 160, to: 70, dur: 0.22, voice: "sawtooth", gain: 0.3 });
  },
  victory() {
    if (!enabled) return;
    [523, 659, 784, 1046].forEach((f, i) =>
      tone({ freq: f, dur: 0.18, gain: 0.34, delay: i * 0.1 }),
    );
  },
  defeat() {
    if (!enabled) return;
    [440, 370, 294, 220].forEach((f, i) =>
      tone({ freq: f, dur: 0.22, voice: "triangle", gain: 0.3, delay: i * 0.12 }),
    );
  },
  unlock() {
    if (!enabled) return;
    [659, 784, 988, 1318, 1568].forEach((f, i) =>
      tone({ freq: f, dur: 0.14, gain: 0.3, delay: i * 0.07 }),
    );
  },
  /** Achievement popup: a bright rising arpeggio with a sparkle on top. */
  achievement() {
    if (!enabled) return;
    [784, 988, 1175, 1568].forEach((f, i) =>
      tone({ freq: f, dur: 0.12, voice: "square", gain: 0.26, delay: i * 0.065 }),
    );
    tone({ freq: 2093, to: 3136, dur: 0.22, voice: "triangle", gain: 0.18, delay: 0.27 });
  },
  /** Pause menu opening — the classic falling two-note blip. */
  menuOpen() {
    if (!enabled) return;
    tone({ freq: 988, dur: 0.06, gain: 0.3 });
    tone({ freq: 659, dur: 0.1, gain: 0.3, delay: 0.07 });
  },
  menuClose() {
    if (!enabled) return;
    tone({ freq: 659, dur: 0.06, gain: 0.3 });
    tone({ freq: 988, dur: 0.1, gain: 0.3, delay: 0.07 });
  },
  /** Cursor moving between menu items. */
  menuMove() {
    if (!enabled) return;
    tone({ freq: 1175, dur: 0.03, voice: "square", gain: 0.14 });
  },
  back() {
    if (!enabled) return;
    tone({ freq: 523, to: 330, dur: 0.09, voice: "triangle", gain: 0.25 });
  },
  /** One typewriter tick. Very quiet — it fires per character. */
  type() {
    if (!enabled) return;
    tone({ freq: 1400 + Math.random() * 300, dur: 0.018, voice: "square", gain: 0.06 });
  },
  /** CRT power-on: a rising sweep and a burst of static. */
  boot() {
    if (!enabled) return;
    tone({ freq: 90, to: 1200, dur: 0.38, voice: "sawtooth", gain: 0.16 });
    noise(0.3, 0.12, 0.05, 3200);
  },
  /** Fighter-select impact. */
  vs() {
    if (!enabled) return;
    noise(0.25, 0.3, 0, 900);
    tone({ freq: 110, to: 55, dur: 0.3, voice: "sawtooth", gain: 0.34 });
    tone({ freq: 880, to: 1760, dur: 0.16, voice: "square", gain: 0.2, delay: 0.12 });
  },
  /** Fast travel / panel slide. */
  whoosh() {
    if (!enabled) return;
    noise(0.22, 0.14, 0, 2400);
  },
  /** Something refused (locked item, illegal move). */
  error() {
    if (!enabled) return;
    tone({ freq: 140, dur: 0.12, voice: "sawtooth", gain: 0.22 });
    tone({ freq: 120, dur: 0.14, voice: "sawtooth", gain: 0.22, delay: 0.1 });
  },
  /** Healing / buff applied. */
  heal() {
    if (!enabled) return;
    [523, 784, 1046].forEach((f, i) =>
      tone({ freq: f, dur: 0.1, voice: "triangle", gain: 0.24, delay: i * 0.05 }),
    );
  },
};
