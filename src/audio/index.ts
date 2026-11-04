import { createRng } from '../motion/rng';
import type { EnginePlugin, Fx, Pt } from '../types';

export type { EnginePlugin };

export interface AudioPlugin extends EnginePlugin {
  unlock(): void;
  setVolume(v: number): void;
}

/** Equal-tempered frequency of a MIDI note. */
export const midiToHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Synthesized glass piano in E: finished pieces play pentatonic notes on a 16th grid; keys tick. */
const PENTA = [0, 2, 4, 7, 9]; // E F# G# B C#
const E2 = 40;
const BPM = 104;
const MAX_VOICES = 28;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function createAudio(
  opts: { volume: number },
  ctxFactory: () => AudioContext = () => new AudioContext({ latencyHint: 'interactive' }),
): AudioPlugin {
  let volume = opts.volume;
  let ctx: AudioContext | null = null;
  let out: GainNode | null = null;
  let master: GainNode | null = null;
  let verb: ConvolverNode | null = null;
  let noise: AudioBuffer | null = null;
  let t0 = 0;
  let dead = false;
  const rng = createRng(0x51a5);
  const rand = (a: number, b: number) => a + rng() * (b - a);
  const slots = new Map<string, number>();
  let keyTimes: number[] = [];
  let pressTimes: number[] = [];
  let ends: number[] = [];

  const ready = () => !!ctx && !dead && ctx.state !== 'suspended' && ctx.state !== 'closed';
  const now = () => ctx!.currentTime;
  const pan = (x: number, vw: number) => clamp((x / Math.max(1, vw)) * 1.6 - 0.8, -0.8, 0.8);

  /** reverb from decaying stereo noise */
  function impulse(secs: number, decay: number): AudioBuffer {
    const sr = ctx!.sampleRate;
    const n = Math.floor(sr * secs);
    const b = ctx!.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const k = i / n;
        lp += (0.55 - 0.4 * k) * (rng() * 2 - 1 - lp);
        d[i] = lp * (1 - k) ** decay * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
      }
    }
    return b;
  }

  /** next slot on the beat grid */
  function grid(div: number): { when: number; slot: string } {
    const step = 60 / BPM / div;
    const k = Math.ceil((now() + 0.015 - t0) / step);
    return { when: t0 + k * step, slot: `${div}:${k}` };
  }

  /** gain → panner → master, optional reverb send */
  function bus(when: number, p: number, send: number): GainNode {
    const c = ctx!;
    const g = c.createGain();
    const sp = c.createStereoPanner();
    sp.pan.setValueAtTime(p, when);
    g.connect(sp);
    sp.connect(master!);
    if (send) {
      const s = c.createGain();
      s.gain.value = send;
      sp.connect(s);
      s.connect(verb!);
    }
    return g;
  }

  /** sine partials, a hammer tick and a long ring */
  function piano(midi: number, when: number, vel: number, p: number, ring = 2.4): void {
    const t = now();
    ends = ends.filter((e) => e > t);
    if (ends.length >= MAX_VOICES) return;
    const c = ctx!;
    const f = midiToHz(midi);
    const v = bus(when, p, 0.85);
    v.gain.value = 0.3 * vel;
    const hi = f > 900;
    for (const [r, a, d] of [[1, 1, 1], [2, 0.38, 0.55], [3, 0.12, 0.32], [2.756, 0.16, 0.42], [5.4, 0.05, 0.16]]) {
      if (f * r > 15000) continue;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * r * (1 + (rng() - 0.5) * 0.002);
      const g = c.createGain();
      const dec = ring * d * (hi ? 0.65 : 1);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(a, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0006, when + dec);
      o.connect(g);
      g.connect(v);
      o.start(when);
      o.stop(when + dec + 0.05);
    }
    hammer(when, v, f);
    ends.push(when + ring * (hi ? 0.65 : 1));
  }

  function hammer(when: number, dest: AudioNode, f: number): void {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(9000, f * 4 + 1200);
    bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.125, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0005, when + 0.03);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(when, rng());
    src.stop(when + 0.05);
  }

  /** filtered-noise tick */
  function tick(when: number, p: number, freq: number, q: number, vel: number, len: number): void {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = bus(when, p, 0.06);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel, when + 0.0008);
    g.gain.exponentialRampToValueAtTime(0.0004, when + len);
    src.connect(bp);
    bp.connect(g);
    src.start(when, rng() * 1.2);
    src.stop(when + len + 0.02);
  }

  /** one key: click plus thock */
  function clack(when: number, p: number, space: boolean, vel: number): void {
    tick(when, p, rand(3600, 5600), 2.2, rand(0.2, 0.3) * vel, rand(0.006, 0.011));
    tick(when + rand(0.001, 0.005), p, space ? rand(380, 560) : rand(850, 1500), 1.6, (space ? 0.26 : rand(0.13, 0.2)) * vel, space ? 0.065 : rand(0.025, 0.042));
  }

  function pad(midi: number, when: number, vel: number, len: number): void {
    const c = ctx!;
    const g = bus(when, 0, 0.9);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel, when + len * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0005, when + len);
    for (const det of [-4, 4]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midiToHz(midi);
      o.detune.value = det;
      o.connect(g);
      o.start(when);
      o.stop(when + len + 0.05);
    }
  }

  /** noise sweep */
  function sweep(t: number, f0: number, f1: number, f2: number | null, peak: number, len: number): void {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + (f2 ? len * 0.4 : len * 0.9));
    if (f2) bp.frequency.exponentialRampToValueAtTime(f2, t + len * 0.8);
    const g = bus(t, 0, 0.6);
    g.gain.setValueAtTime(f2 ? 0 : peak, t);
    if (f2) g.gain.linearRampToValueAtTime(peak, t + len * 0.32);
    g.gain.exponentialRampToValueAtTime(0.0005, t + len);
    src.connect(bp);
    bp.connect(g);
    src.start(t);
    src.stop(t + len + 0.1);
  }

  function key(x: number, vw: number, n: number, space: boolean): void {
    const t = now();
    keyTimes = keyTimes.filter((k) => t - k < 1);
    const p = pan(x, vw);
    // several keys in one frame roll
    let at = t + 0.004;
    for (let k = 0; k < Math.min(n, 3) && keyTimes.length <= 80; k++) {
      keyTimes.push(t);
      clack(at, p, space && k === 0, rand(0.75, 1));
      at += rand(0.018, 0.032);
    }
  }

  /** press and release */
  function press(x: number, vw: number): void {
    const t = now();
    pressTimes = pressTimes.filter((k) => t - k < 1);
    if (pressTimes.length > 40) return;
    pressTimes.push(t);
    const p = pan(x, vw);
    tick(t + 0.004, p, rand(2100, 2700), 4, 0.32, 0.012);
    tick(t + 0.005, p, rand(650, 850), 2, 0.16, 0.022);
    tick(t + rand(0.055, 0.075), p, rand(2900, 3400), 4, 0.15, 0.008);
  }

  /** a finished piece; only boxes, media, dups and guides play a note */
  function place(kind: Extract<Fx, { k: 'place' }>['kind'], r: { x: number; y: number; w: number; h: number }, vp: { w: number; h: number }): void {
    if (kind === 'text' || kind === 'line') return;
    const area = (r.w * r.h) / Math.max(1, vp.w * vp.h);
    const oct = kind === 'guide' ? 5 : area > 0.08 ? 1 : area > 0.015 ? 2 : area > 0.002 ? 3 : 4;
    const cx = r.x + r.w / 2;
    const deg = Math.floor(clamp(cx / Math.max(1, vp.w), 0, 0.999) * 5);
    const midi = E2 + oct * 12 + PENTA[deg];
    const { when, slot } = grid(2);
    if (slots.has(slot)) return;
    slots.set(slot, midi);
    if (slots.size > 64) slots.delete(slots.keys().next().value!);
    const off = r.y < -40 || r.y > vp.h + 40 ? 0.45 : 1;
    const p = pan(cx, vp.w);
    const vel = ({ box: 0.55, media: 0.5, dup: 0.5, guide: 0.3 } as Record<string, number>)[kind] * 0.42;
    const ring = oct <= 1 ? 3.6 : oct >= 4 ? 1.6 : 2.4;
    piano(midi, when, vel * off, p, ring);
    if (kind === 'media') piano(midi + ((PENTA[(deg + 2) % 5] - PENTA[deg] + 12) % 12), when + 0.04, vel * 0.6 * off, p, ring);
    if (kind === 'dup') piano(E2 + 12 + (deg % 2 ? 7 : 0), when, 0.15 * off, p * 0.5, 2.8);
  }

  return {
    unlock() {
      if (ctx || dead) return;
      const c = (ctx = ctxFactory());
      out = c.createGain();
      out.gain.value = volume;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 14;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.3;
      master = c.createGain();
      master.gain.value = 0.9;
      master.connect(comp);
      comp.connect(out);
      out.connect(c.destination);
      verb = c.createConvolver();
      verb.buffer = impulse(3.2, 2.4);
      const wet = c.createGain();
      wet.gain.value = 0.5;
      verb.connect(wet);
      wet.connect(master);
      noise = c.createBuffer(1, Math.floor(c.sampleRate * 1.5), c.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
      t0 = c.currentTime;
      c.resume?.()?.catch?.(() => {});
    },

    setVolume(v) {
      volume = v;
      if (out) out.gain.value = v;
    },

    onFx(fx: Fx, at: Pt, vp) {
      if (!ready()) return;
      if (fx.k === 'press') press(at.x, vp.w);
      else if (fx.k === 'key') key(at.x, vp.w, fx.n, fx.space);
      else if (fx.k === 'place') place(fx.kind, fx.r, vp);
      else if (fx.k === 'snap') {
        const t = now() + 0.004;
        const p = pan(at.x, vp.w);
        tick(t, p, 4800, 3, 0.36, 0.012);
        tick(t + 0.002, p, 1200, 2, 0.2, 0.03);
      } else tick(now() + 0.004, pan(at.x, vp.w), 2400 + fx.step * 260, 5, 0.12, 0.01);
    },

    /** intro swell */
    onIntro() {
      if (!ready()) return;
      const t = now() + 0.02;
      sweep(t, 260, 2400, 900, 0.16, 2.2);
      [[E2, 0], [E2 + 7, 0.08], [E2 + 12, 0.16]].forEach(([m, d]) => pad(m, t + 0.3 + d, 0.07, 2.6));
    },

    /** start arpeggio */
    onStart() {
      if (!ready()) return;
      const { when } = grid(4);
      const step = 60 / BPM / 4;
      [E2 + 24, E2 + 28, E2 + 31, E2 + 36, E2 + 40].forEach((m, i) => piano(m, when + i * step, 0.2, -0.5 + i * 0.25, 2));
    },

    /** final chord */
    onComplete() {
      if (!ready()) return;
      const { when } = grid(2);
      const chord = [E2, E2 + 7, E2 + 12, E2 + 16, E2 + 19, E2 + 26, E2 + 28, E2 + 31, E2 + 36, E2 + 43];
      chord.forEach((m, i) => piano(m, when + i * 0.035, 0.34 - i * 0.015, -0.6 + (i / chord.length) * 1.2, 5.5));
      pad(E2 + 12, when, 0.05, 5);
    },

    /** release */
    destroy() {
      if (dead) return;
      const c = ctx;
      if (c && ready()) {
        const t = now() + 0.01;
        sweep(t, 3000, 220, null, 0.12, 1.1);
        piano(E2 + 12, t + 0.05, 0.3, 0, 2.5);
      }
      dead = true;
      if (!c) return;
      const g = out!.gain;
      const t = c.currentTime;
      g.cancelScheduledValues?.(t);
      g.setValueAtTime?.(g.value, t);
      g.linearRampToValueAtTime?.(0, t + 1.2);
      setTimeout(() => void c.close?.()?.catch?.(() => {}), 1400);
      ctx = out = master = verb = noise = null;
    },
  };
}
