import { describe, expect, test, vi } from 'vitest';
import { createAudio, midiToHz } from '../../src/audio/index';
import type { Fx } from '../../src/types';

function param(v = 0) {
  return {
    value: v,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}
const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });

/** A stand-in AudioContext that counts what gets built and records oscillator frequencies. */
function fakeCtx(state = 'running') {
  const n = { osc: 0, gain: 0, src: 0, buf: 0, filter: 0, pan: 0 };
  const freqs: number[] = [];
  const gains: { gain: ReturnType<typeof param> }[] = [];
  const ctx = {
    currentTime: 1,
    sampleRate: 4000,
    destination: node(),
    state,
    close: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    createOscillator: () => {
      n.osc++;
      const frequency = param();
      const idx = freqs.push(0) - 1;
      Object.defineProperty(frequency, 'value', { get: () => freqs[idx], set: (v) => (freqs[idx] = v) });
      return { ...node(), type: 'sine', frequency, detune: param(), start: vi.fn(), stop: vi.fn() };
    },
    createGain: () => {
      n.gain++;
      const g = { ...node(), gain: param(1) };
      gains.push(g);
      return g;
    },
    createBufferSource: () => {
      n.src++;
      return { ...node(), buffer: null, loop: false, start: vi.fn(), stop: vi.fn() };
    },
    createBuffer: (ch: number, len: number) => {
      n.buf++;
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { getChannelData: (i: number) => data[i], length: len, numberOfChannels: ch };
    },
    createBiquadFilter: () => {
      n.filter++;
      return { ...node(), type: 'lowpass', frequency: param(), Q: param() };
    },
    createStereoPanner: () => {
      n.pan++;
      return { ...node(), pan: param() };
    },
    createDynamicsCompressor: () => ({ ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createConvolver: () => ({ ...node(), buffer: null }),
  };
  return { ctx: ctx as unknown as AudioContext, n, freqs, gains, raw: ctx };
}

const vp = { w: 1000, h: 800 };
const at = { x: 500, y: 400 };
const place = (kind: Extract<Fx, { k: 'place' }>['kind'], w = 100, h = 60, x = 400): Fx => ({ k: 'place', kind, r: { x, y: 300, w, h } });
/** E major pentatonic pitch classes: E F# G# B C# */
const PENTA_PC = new Set([4, 6, 8, 11, 1]);
const pcOf = (hz: number) => (((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12);

describe('glass piano audio', () => {
  test('nothing is created before unlock (a user gesture); events before it are dropped', () => {
    const f = fakeCtx();
    const factory = vi.fn(() => f.ctx);
    const a = createAudio({ volume: 0.5 }, factory);
    a.onFx!(place('box'), at, vp);
    a.onStart!();
    expect(factory).not.toHaveBeenCalled();
    a.unlock();
    a.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(f.gains[0].gain.value).toBe(0.5);
  });

  test('a finished box plays a glass-piano note from the E major pentatonic', () => {
    const f = fakeCtx();
    const a = createAudio({ volume: 1 }, () => f.ctx);
    a.unlock();
    const before = f.n.osc;
    a.onFx!(place('box'), at, vp);
    const played = f.freqs.slice(before).filter((v) => v > 0);
    expect(played.length).toBeGreaterThanOrEqual(3);
    // the fundamental is the lowest partial
    expect(PENTA_PC.has(pcOf(Math.min(...played)))).toBe(true);
  });

  test('big sections play low, small pieces high; pitch rises left to right', () => {
    const low = fakeCtx();
    const a = createAudio({ volume: 1 }, () => low.ctx);
    a.unlock();
    let b = low.n.osc;
    a.onFx!(place('box', 900, 700), at, vp);
    const big = Math.min(...low.freqs.slice(b).filter((v) => v > 0));
    low.raw.currentTime += 1;
    b = low.n.osc;
    a.onFx!(place('box', 30, 20), at, vp);
    const small = Math.min(...low.freqs.slice(b).filter((v) => v > 0));
    expect(small).toBeGreaterThan(big * 3);
    low.raw.currentTime += 1;
    b = low.n.osc;
    a.onFx!(place('box', 30, 20, 0), at, vp);
    const left = Math.min(...low.freqs.slice(b).filter((v) => v > 0));
    low.raw.currentTime += 1;
    b = low.n.osc;
    a.onFx!(place('box', 30, 20, 950), at, vp);
    const right = Math.min(...low.freqs.slice(b).filter((v) => v > 0));
    expect(right).toBeGreaterThan(left);
  });

  test('text and lines stay percussive (no note); two pieces in one grid slot sing once', () => {
    const f = fakeCtx();
    const a = createAudio({ volume: 1 }, () => f.ctx);
    a.unlock();
    const b = f.n.osc;
    a.onFx!(place('text'), at, vp);
    a.onFx!(place('line'), at, vp);
    expect(f.n.osc).toBe(b);
    a.onFx!(place('box'), at, vp);
    const one = f.n.osc;
    a.onFx!(place('box'), at, vp);
    expect(f.n.osc).toBe(one);
  });

  test('keys are mechanical clacks: noise through band-pass filters, panned to the cursor', () => {
    const f = fakeCtx();
    const a = createAudio({ volume: 1 }, () => f.ctx);
    a.unlock();
    const src = f.n.src;
    const fil = f.n.filter;
    a.onFx!({ k: 'key', n: 2, space: false }, { x: 100, y: 0 }, vp);
    expect(f.n.src - src).toBe(4); // two keys, a click and a thock each
    expect(f.n.filter - fil).toBe(4);
    a.onFx!({ k: 'press' }, at, vp);
    expect(f.n.src - src).toBe(7); // press click, body, lighter release
  });

  test('intro swell, start arpeggio (5 notes) and the strummed finale chord', () => {
    const f = fakeCtx();
    const a = createAudio({ volume: 1 }, () => f.ctx);
    a.unlock();
    let b = f.n.osc;
    a.onIntro!();
    expect(f.n.osc - b).toBe(6); // three pad notes, two detuned voices each
    b = f.n.osc;
    a.onStart!();
    const arp = f.freqs.slice(b);
    expect(arp.filter((v) => v > 0).length).toBeGreaterThanOrEqual(5 * 4);
    f.raw.currentTime += 1;
    b = f.n.osc;
    a.onComplete!();
    const chord = new Set(f.freqs.slice(b).map((v) => Math.round(v)));
    expect(chord.has(Math.round(midiToHz(40)))).toBe(true); // low E
  });

  test('a suspended context (autoplay blocked) stays silent', () => {
    const f = fakeCtx('suspended');
    const a = createAudio({ volume: 1 }, () => f.ctx);
    a.unlock();
    const b = f.n.osc;
    a.onFx!(place('box'), at, vp);
    expect(f.n.osc).toBe(b);
  });

  test('setVolume, and destroy fades out, closes the context, and ignores later events', () => {
    vi.useFakeTimers();
    const f = fakeCtx();
    const a = createAudio({ volume: 1 }, () => f.ctx);
    a.setVolume(0.2);
    a.unlock();
    expect(f.gains[0].gain.value).toBe(0.2);
    a.destroy!();
    vi.advanceTimersByTime(2000);
    expect(f.raw.close).toHaveBeenCalled();
    const b = f.n.osc;
    a.onFx!(place('box'), at, vp);
    expect(f.n.osc).toBe(b);
    vi.useRealTimers();
  });
});
