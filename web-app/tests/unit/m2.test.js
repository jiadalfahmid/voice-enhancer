import { describe, it, expect } from 'vitest';
import { encodeWav, encodeWavParts } from '../../src/audio/encode-wav.js';
import { encodeMp3 } from '../../src/audio/encode-mp3.js';
import { PRESETS, DEFAULTS, applyPreset, loadSettings, saveSettings } from '../../src/audio/presets.js';
import { computePeaks, gainsFor, loopPosition, CROSSFADE_SECONDS } from '../../src/audio/ab.js';
import { fileModeSupport } from '../../src/audio/capabilities.js';
import { enhanceFile, renderOutput } from '../../src/audio/pipeline.js';
import { passthroughModel } from '../../src/audio/models.js';
import { DEPTH_LEVELS, ECHO_LEVELS } from '../../src/audio/postprocess.js';

const tone = (f, fs, n, a) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / fs));

describe('WAV parts', () => {
  for (const bits of [16, 24]) {
    it(`parts are byte-identical to encodeWav (${bits}-bit stereo, odd length, small chunks)`, () => {
      const L = tone(440, 48000, 10007, 0.7), R = tone(660, 48000, 10007, 0.4);
      const whole = encodeWav([L, R], 48000, bits);
      const parts = encodeWavParts([L, R], 48000, bits, 1000);
      const cat = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0; for (const p of parts) { cat.set(p, o); o += p.length; }
      expect(Array.from(cat)).toEqual(Array.from(whole));
    });
  }
});

describe('MP3 encoder wrapper', () => {
  class Fake {
    constructor(c, fs, k) { Fake.last = { c, fs, k, frames: 0, maxAbs: 0 }; }
    encodeBuffer(l) { Fake.last.frames += l.length; for (const v of l) Fake.last.maxAbs = Math.max(Fake.last.maxAbs, Math.abs(v)); return new Int8Array([1]); }
    flush() { return new Int8Array([2]); }
  }
  it('feeds every sample as clipped int16 and flushes', async () => {
    const x = Float32Array.from({ length: 100000 }, () => 2); // over full scale: must clip
    const prog = [];
    const parts = await encodeMp3([x], 44100, 128, { Mp3Encoder: Fake, onProgress: (v) => prog.push(v) });
    expect(Fake.last.frames).toBe(100000);
    expect(Fake.last.maxAbs).toBe(32767);
    expect(Fake.last.k).toBe(128);
    expect(prog[prog.length - 1]).toBe(1);
    expect(parts[parts.length - 1][0]).toBe(2);
  });
  it('resamples unsupported rates to 48 kHz and rejects bad bitrates / missing encoder', async () => {
    await encodeMp3([tone(440, 96000, 96000, 0.5)], 96000, 192, { Mp3Encoder: Fake });
    expect(Fake.last.fs).toBe(48000);
    let e1 = null, e2 = null;
    try { await encodeMp3([new Float32Array(10)], 48000, 100, { Mp3Encoder: Fake }); } catch (e) { e1 = e; }
    try { await encodeMp3([new Float32Array(10)], 48000, 192, {}); } catch (e) { e2 = e; }
    expect(e1 !== null).toBe(true);
    expect(e2.code).toBe('MP3_UNAVAILABLE');
  });
});

describe('presets and settings', () => {
  it('every preset only uses values the UI/pipeline understand', () => {
    for (const p of Object.values(PRESETS)) {
      expect(p.depth in DEPTH_LEVELS).toBe(true);
      expect(p.echo in ECHO_LEVELS).toBe(true);
      expect(p.target >= -30 && p.target <= -8).toBe(true);
      expect(p.strength >= 0 && p.strength <= 100).toBe(true);
    }
  });
  it('applyPreset overrides preset fields and keeps others (e.g. engine)', () => {
    const out = applyPreset({ ...DEFAULTS, engine: 'passthrough' }, 'call');
    expect(out.engine).toBe('passthrough');
    expect(out.target).toBe(PRESETS.call.target);
    expect('label' in out).toBe(false);
  });
  it('settings persist through storage and survive blocked/corrupt storage', () => {
    const mem = {}; const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
    saveSettings({ ...DEFAULTS, target: -14 }, storage);
    expect(loadSettings(storage).target).toBe(-14);
    expect(loadSettings({ getItem: () => '{not json' }).target).toBe(DEFAULTS.target);
    expect(loadSettings({ getItem: () => { throw new Error('blocked'); } }).target).toBe(DEFAULTS.target);
    saveSettings(DEFAULTS, { setItem: () => { throw new Error('blocked'); } }); // must not throw
  });
});

describe('A/B helpers', () => {
  it('peaks cover the whole signal and respect min/max', () => {
    const x = new Float32Array(1000); x[250] = 0.8; x[750] = -0.6;
    const { min, max } = computePeaks([x], 4);
    expect(max[1]).toBeCloseTo(0.8, 5);
    expect(min[3]).toBeCloseTo(-0.6, 5);
    expect(min.length).toBe(4);
  });
  it('gains switch fully between A and B and the crossfade is 10 ms', () => {
    expect(gainsFor('a')).toEqual({ a: 1, b: 0 });
    expect(gainsFor('b')).toEqual({ a: 0, b: 1 });
    expect(CROSSFADE_SECONDS).toBe(0.01);
  });
  it('loop position wraps', () => {
    expect(loopPosition(25, 20)).toBe(5);
    expect(loopPosition(-1, 20)).toBe(19);
    expect(loopPosition(3, 0)).toBe(0);
  });
});

describe('capability fallbacks', () => {
  it('flags missing Worker / WebAssembly / Web Audio, accepts a normal browser', () => {
    const none = fileModeSupport({});
    expect(none.supported).toBe(false);
    expect(none.reasons.length).toBe(3);
    expect(fileModeSupport({ Worker: class {}, WebAssembly: {}, AudioContext: class {} }).supported).toBe(true);
    expect(fileModeSupport({ Worker: class {}, WebAssembly: {}, webkitAudioContext: class {} }).supported).toBe(true);
  });
});

describe('dry/wet alignment with GTCRN-style framing (F4: exact latency, no comb filtering)', () => {
  const pass256 = { id: 'p256', label: 'x', hop: 256, createState: () => null, async process(re, im) { return { re: Float32Array.from(re), im: Float32Array.from(im) }; } };
  it('wet is sample-aligned with dry (cross-correlation peak at lag 0) at hop 256', async () => {
    const fs = 16000;
    let s = 5;
    const x = Float32Array.from({ length: fs * 4 }, () => { s = (s * 1664525 + 1013904223) >>> 0; return 0.3 * ((s / 2 ** 32) * 2 - 1); });
    const { dry, wet } = await enhanceFile({ channels: [x], sampleRate: fs, model: pass256, hpf: { enabled: false }, chunkSeconds: 4 });
    let best = 0, bestLag = 0;
    for (let lag = -40; lag <= 40; lag++) {
      let c = 0;
      for (let i = 2000; i < 60000; i++) c += dry[0][i] * wet[0][i + lag];
      if (c > best) { best = c; bestLag = lag; }
    }
    expect(bestLag).toBe(0);
  });
  it('a 50% mix keeps the magnitude response flat (no comb notches) when wet ~ dry', async () => {
    const fs = 48000, n = fs * 4;
    let s = 11;
    const x = Float32Array.from({ length: n }, () => { s = (s * 1664525 + 1013904223) >>> 0; return 0.2 * ((s / 2 ** 32) * 2 - 1); });
    const { dry, wet, sampleRate } = await enhanceFile({ channels: [x], sampleRate: fs, model: pass256, hpf: { enabled: false }, chunkSeconds: 4 });
    const mix = renderOutput({ dry, wet, sampleRate }, { strength: 0.5, normalize: false, useLimiter: false }).channels[0];
    // compare average power in 40 narrow bands between mix and dry: all within 0.5 dB
    const band = (sig, f0, f1) => {
      let p = 0;
      for (let f = f0; f < f1; f += 25) { let re = 0, im = 0; for (let i = 8000; i < 8000 + 8192; i++) { const a = (2 * Math.PI * f * i) / fs; re += sig[i] * Math.cos(a); im += sig[i] * Math.sin(a); } p += re * re + im * im; }
      return p;
    };
    let worst = 0;
    for (let f0 = 200; f0 < 7000; f0 += 400) worst = Math.max(worst, Math.abs(10 * Math.log10(band(mix, f0, f0 + 400) / band(dry[0], f0, f0 + 400))));
    expect(worst).toBeLessThan(0.5);
  });
});
