import { describe, expect, test, vi } from 'vitest';
import { createAudio, midiToHz } from '../../src/audio/index';

function param(v = 0) {
  return {
    value: v,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}
const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });

function fakeCtx() {
  const n = { osc: 0, gain: 0, src: 0, buf: 0, filter: 0, pan: 0 };
  const freqs: number[] = [];
  const masters: { gain: ReturnType<typeof param> }[] = [];
  const ctx = {
    currentTime: 1,
    sampleRate: 8000,
    destination: node(),
    state: 'suspended',
    close: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    createOscillator: () => {
      n.osc++;
      const frequency = param();
      const o = { ...node(), type: 'sine', frequency, start: vi.fn(), stop: vi.fn() };
      freqs.push(0);
      const idx = freqs.length - 1;
      Object.defineProperty(frequency, 'value', { get: () => freqs[idx], set: (v) => (freqs[idx] = v) });
      return o;
    },
    createGain: () => {
      n.gain++;
      const g = { ...node(), gain: param(1) };
      masters.push(g);
      return g;
    },
    createBufferSource: () => {
      n.src++;
      return { ...node(), buffer: null, start: vi.fn(), stop: vi.fn() };
    },
    createBuffer: (_c: number, len: number) => {
      n.buf++;
      const data = new Float32Array(len);
      return { getChannelData: () => data, length: len };
    },
    createBiquadFilter: () => {
      n.filter++;
      return { ...node(), type: 'lowpass', frequency: param(), Q: param() };
    },
    createStereoPanner: () => {
      n.pan++;
      return { ...node(), pan: param() };
    },
  };
  return { ctx: ctx as unknown as AudioContext, n, freqs, masters, raw: ctx };
}

describe('audio plugin', () => {
  test('no context before unlock; events before unlock create nothing', () => {
    const f = fakeCtx();
    const factory = vi.fn(() => f.ctx);
    const a = createAudio({ volume: 0.5 }, factory);
    a.onTask!('box', 0.5);
    a.onKey!(0.3);
    a.onComplete!();
    expect(factory).not.toHaveBeenCalled();
    expect(f.n.osc + f.n.src + f.n.gain).toBe(0);
  });

  test('unlock creates the context once and the master gain at the volume', () => {
    const f = fakeCtx();
    const factory = vi.fn(() => f.ctx);
    const a = createAudio({ volume: 0.4 }, factory);
    a.unlock();
    a.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(f.masters[0].gain.value).toBe(0.4);
    expect(f.raw.resume).toHaveBeenCalled();
  });

  test('a piece landing plays at least one oscillator', () => {
    const f = fakeCtx();
    const a = createAudio({ volume: 0.5 }, () => f.ctx);
    a.unlock();
    a.onTask!('box', 0.5);
    expect(f.n.osc).toBeGreaterThanOrEqual(1);
  });

  test('notes come from pentatonic A minor at octave 5, deterministically', () => {
    const allowed = [81, 84, 86, 88, 91].map(midiToHz);
    const run = () => {
      const f = fakeCtx();
      const a = createAudio({ volume: 0.5 }, () => f.ctx);
      a.unlock();
      for (let i = 0; i < 12; i++) a.onTask!('box', 0.5);
      return f.freqs.filter((_, i) => i % 2 === 0); // sine of each sine+triangle pair
    };
    const first = run();
    expect(first.length).toBe(12);
    for (const hz of first) expect(allowed.some((x) => Math.abs(x - hz) < 1e-6)).toBe(true);
    expect(run()).toEqual(first);
    expect(midiToHz(69)).toBe(440);
  });

  test('keys are panned noise clicks sharing one noise buffer', () => {
    const f = fakeCtx();
    const a = createAudio({ volume: 0.5 }, () => f.ctx);
    a.unlock();
    const bufs = f.n.buf;
    a.onKey!(0);
    a.onKey!(1);
    a.onKey!(0.5);
    expect(f.n.src).toBe(3);
    expect(f.n.pan).toBe(3);
    expect(f.n.filter).toBe(3);
    expect(f.n.buf).toBe(bufs);
    expect(f.n.osc).toBe(0);
  });

  test('guide ticks and the completion chord (5 notes)', () => {
    const f = fakeCtx();
    const a = createAudio({ volume: 0.5 }, () => f.ctx);
    a.unlock();
    a.onTask!('guide', 0.5);
    const afterGuide = f.n.osc;
    expect(afterGuide).toBeGreaterThanOrEqual(1);
    a.onComplete!();
    expect(f.n.osc - afterGuide).toBe(5);
    expect(f.freqs.slice(afterGuide)).toEqual([69, 72, 76, 79, 83].map(midiToHz));
  });

  test('setVolume updates the master gain, also before unlock', () => {
    const f = fakeCtx();
    const a = createAudio({ volume: 0.5 }, () => f.ctx);
    a.setVolume(0.3);
    a.unlock();
    expect(f.masters[0].gain.value).toBe(0.3);
    a.setVolume(0.2);
    expect(f.masters[0].gain.value).toBe(0.2);
  });

  test('destroy closes the context and later events do nothing', () => {
    const f = fakeCtx();
    const a = createAudio({ volume: 0.5 }, () => f.ctx);
    a.unlock();
    a.destroy!();
    expect(f.raw.close).toHaveBeenCalledTimes(1);
    const before = f.n.osc;
    a.onTask!('box', 0.5);
    a.unlock();
    expect(f.n.osc).toBe(before);
  });
});
