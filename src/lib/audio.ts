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

function noise(dur = 0.16, gain = 0.35, delay = 0) {
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
  filt.frequency.value = 1400;
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
};
