import type { EnginePlugin, TaskType } from '../types';

export type { EnginePlugin };

export interface AudioPlugin extends EnginePlugin {
  unlock(): void;
  setVolume(v: number): void;
}

/** Equal-tempered frequency of a MIDI note. */
export const midiToHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

// Pentatonic A minor at octave 5: A C D E G.
const SCALE = [81, 84, 86, 88, 91].map(midiToHz);
// Am9: A4 C5 E5 G5 B5.
const CHORD = [69, 72, 76, 79, 83].map(midiToHz);
const CLICK_HZ = [2200, 2600, 3000, 3400];
const CLICK_S = 0.012;
const NOTE_S = 0.6;
const SWELL_S = 1.8;

/**
 * Synthesized sound, all WebAudio and no samples. The context is created on the first `unlock()`
 * (a user gesture, so autoplay policies allow it); events before that are dropped.
 */
export function createAudio(
  opts: { volume: number },
  ctxFactory: () => AudioContext = () => new AudioContext(),
): AudioPlugin {
  let volume = opts.volume;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let dead = false;
  // A counter, not Math.random, so the output is deterministic.
  let step = 0;

  /** One enveloped oscillator into the master bus. */
  function tone(type: OscillatorType, hz: number, at: number, peak: number, attack: number, decay: number): void {
    const c = ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    o.connect(g);
    g.connect(master!);
    o.start(at);
    o.stop(at + attack + decay + 0.05);
  }

  return {
    unlock() {
      if (ctx || dead) return;
      ctx = ctxFactory();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      const len = Math.max(1, Math.round(ctx.sampleRate * CLICK_S));
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noise.getChannelData(0);
      let s = 1;
      for (let i = 0; i < len; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        data[i] = (s / 0x80000000 - 1) * (1 - i / len);
      }
      void ctx.resume?.();
    },

    setVolume(v) {
      volume = v;
      if (master) master.gain.value = v;
    },

    onKey(xNorm) {
      if (!ctx) return;
      const src = ctx.createBufferSource();
      const bp = ctx.createBiquadFilter();
      const pan = ctx.createStereoPanner();
      const g = ctx.createGain();
      src.buffer = noise;
      bp.type = 'bandpass';
      bp.frequency.value = CLICK_HZ[step++ % CLICK_HZ.length];
      bp.Q.value = 2;
      pan.pan.value = Math.min(1, Math.max(-1, xNorm * 2 - 1));
      g.gain.value = 0.9;
      src.connect(bp);
      bp.connect(g);
      g.connect(pan);
      pan.connect(master!);
      src.start(ctx.currentTime);
    },

    onTask(type: TaskType) {
      if (!ctx) return;
      const t = ctx.currentTime;
      if (type === 'guide') {
        tone('sine', midiToHz(96), t, 0.12, 0.002, 0.06);
        return;
      }
      const hz = SCALE[step++ % SCALE.length];
      tone('sine', hz, t, 0.22, 0.01, NOTE_S);
      tone('triangle', hz, t, 0.1, 0.01, NOTE_S * 0.7);
    },

    onComplete() {
      if (!ctx) return;
      const t = ctx.currentTime;
      CHORD.forEach((hz, i) => {
        tone('sine', hz, t + i * 0.04, 0.12, SWELL_S * 0.55, SWELL_S * 0.45 + 0.4);
      });
    },

    destroy() {
      dead = true;
      const c = ctx;
      ctx = master = noise = null;
      void c?.close();
    },
  };
}
