import { describe, it, expect } from 'vitest';
import { enhanceFile, renderOutput, renderWindow, CancelledError } from '../../src/audio/pipeline.js';
import { passthroughModel, spectralGateModel } from '../../src/audio/models.js';
import { integratedLufs } from '../../src/audio/lufs.js';
import { analyzeLoudness, loudnessAt } from '../../src/audio/loudness-cache.js';
import { mixDryWet } from '../../src/audio/mixer.js';

function noise(n, amp, seed = 7) {
  const x = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; x[i] = amp * ((s / 2 ** 32) * 2 - 1); }
  return x;
}
const voiceLike = (fs, sec) => Float32Array.from({ length: Math.round(fs * sec) }, (_, i) => {
  const t = i / fs;
  const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t);
  return 0.3 * env * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 660 * t));
});
const tone = (f, fs, n, a) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / fs));
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
const db = (v) => 20 * Math.log10(v);
/** amplitude of a sinusoid at f (single-bin DFT over [a,b)) */
function toneAmp(x, f, fs, a, b) {
  let re = 0, im = 0;
  for (let i = a; i < b; i++) { const p = (2 * Math.PI * f * i) / fs; re += x[i] * Math.cos(p); im += x[i] * Math.sin(p); }
  return (2 * Math.hypot(re, im)) / (b - a);
}
const scaled = (k) => ({ id: `x${k}`, label: 'x', hop: 160, createState: () => null,
  async process(re, im) { return { re: re.map((v) => v * k), im: im.map((v) => v * k) }; } });

describe('enhanceFile', () => {
  it('mask=1 passthrough reproduces the input across chunk boundaries (band-limited path + restored high band)', async () => {
    const fs = 48000;
    const x = voiceLike(fs, 10);
    const { dry, wet } = await enhanceFile({ channels: [x], sampleRate: fs, model: passthroughModel, hpf: { enabled: false }, chunkSeconds: 3 });
    expect(wet[0].length).toBe(x.length);
    let maxErr = 0;
    for (let i = 2000; i < x.length - 2000; i++) maxErr = Math.max(maxErr, Math.abs(wet[0][i] - dry[0][i]));
    expect(maxErr).toBeLessThan(2e-3);
  });
  it('dry is the untouched input even with the high-pass on; only wet loses the rumble', async () => {
    const fs = 16000;
    const x = tone(30, fs, fs * 6, 0.3);
    const copy = Float32Array.from(x);
    const { dry, wet } = await enhanceFile({ channels: [x], sampleRate: fs, model: passthroughModel, hpf: { enabled: true, fc: 80 }, chunkSeconds: 3 });
    expect(dry[0]).toBe(x);
    expect(Array.from(dry[0])).toEqual(Array.from(copy));
    expect(db(rms(wet[0], 4000, 90000) / rms(x, 4000, 90000))).toBeLessThan(-10);
  });
  it('handles stereo at 44.1 kHz and keeps length and balance', async () => {
    const fs = 44100;
    const a = voiceLike(fs, 5), b = voiceLike(fs, 5).map((v) => v * 0.5);
    const { wet } = await enhanceFile({ channels: [a, b], sampleRate: fs, model: passthroughModel, hpf: { enabled: false }, chunkSeconds: 2 });
    expect(wet.length).toBe(2);
    expect(wet[0].length).toBe(a.length);
    expect(rms(wet[1], 3000, a.length - 3000) / rms(wet[0], 3000, a.length - 3000)).toBeCloseTo(0.5, 2);
  });
  it('high band follows the model gain when 4-8 kHz content exists', async () => {
    const fs = 48000, n = fs * 6;
    const x = new Float32Array(n);
    const t1 = tone(6000, fs, n, 0.2), t2 = tone(10000, fs, n, 0.2);
    for (let i = 0; i < n; i++) x[i] = t1[i] + t2[i];
    const run = async (model) => (await enhanceFile({ channels: [x], sampleRate: fs, model, hpf: { enabled: false }, chunkSeconds: 3 })).wet[0];
    const pass = toneAmp(await run(passthroughModel), 10000, fs, 48000, 240000);
    const half = toneAmp(await run(scaled(0.5)), 10000, fs, 48000, 240000);
    const zero = toneAmp(await run(scaled(0)), 10000, fs, 48000, 240000);
    expect(pass).toBeGreaterThan(0.18);
    expect(half).toBeGreaterThan(0.08);
    expect(half).toBeLessThan(0.12);
    expect(zero).toBeLessThan(0.02);
  });
  it('reports monotonic progress ending at 1', async () => {
    const seen = [];
    await enhanceFile({ channels: [voiceLike(16000, 6)], sampleRate: 16000, model: passthroughModel, chunkSeconds: 2, onProgress: (f) => seen.push(f) });
    for (let i = 1; i < seen.length; i++) expect(seen[i] >= seen[i - 1]).toBe(true);
    expect(seen[seen.length - 1]).toBe(1);
  });
  it('cancel rejects with CancelledError and stops early', async () => {
    let calls = 0;
    let threw = false;
    try {
      await enhanceFile({
        channels: [voiceLike(16000, 20)], sampleRate: 16000, model: passthroughModel, chunkSeconds: 2,
        onProgress: () => { calls++; }, isCancelled: () => calls >= 3,
      });
    } catch (e) { threw = e instanceof CancelledError; }
    expect(threw).toBe(true);
    expect(calls < 8).toBe(true);
  });
  it('demo spectral gate lowers background noise in a speech-free stretch', async () => {
    const fs = 16000;
    const n = fs * 8;
    const sp = voiceLike(fs, 8);
    const x = noise(n, 0.02);
    for (let i = fs * 3; i < n; i++) x[i] += sp[i];
    const { wet, dry } = await enhanceFile({ channels: [x], sampleRate: fs, model: spectralGateModel, hpf: { enabled: false }, chunkSeconds: 4 });
    expect(db(rms(wet[0], fs, fs * 2.5) / rms(dry[0], fs, fs * 2.5))).toBeLessThan(-6);
  });
});

describe('loudness cache', () => {
  const fs = 48000;
  const d = [voiceLike(fs, 12), voiceLike(fs, 12).map((v) => v * 0.7)];
  const w = d.map((x) => x.map((v, i) => 0.6 * v + 0.01 * Math.sin(i * 0.37)));
  it('loudnessAt matches measuring the real mix (< 0.01 dB) at several strengths', async () => {
    const stats = await analyzeLoudness(d, w, fs);
    for (const s of [0, 0.3, 0.75, 1]) {
      const real = integratedLufs(mixDryWet(d, w, s, 0), fs);
      expect(Math.abs(loudnessAt(stats, s) - real)).toBeLessThan(0.01);
    }
  });
});

describe('renderOutput / renderWindow', () => {
  const fs = 48000;
  const x = voiceLike(fs, 12);
  const wetX = x.map((v) => v * 0.8);
  const bare = { dry: [x], wet: [wetX], sampleRate: fs };

  it('strength 0 with normalize/limiter off is exactly the dry input (null test)', () => {
    const { channels } = renderOutput(bare, { strength: 0, normalize: false, useLimiter: false });
    expect(Array.from(channels[0])).toEqual(Array.from(x));
  });
  it('lands within +-0.5 LU of target and under the ceiling', async () => {
    const cache = { ...bare, loud: await analyzeLoudness(bare.dry, bare.wet, fs) };
    const { channels, lufs } = renderOutput(cache, { strength: 0.5, targetLufs: -16 });
    expect(Math.abs(lufs + 16)).toBeLessThan(0.5);
    expect(Math.abs(integratedLufs(channels, fs) + 16)).toBeLessThan(0.5);
    expect(channels[0].reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThan(Math.pow(10, -1 / 20) + 1e-4);
  });
  it('loudness is the same at any strength (slider does not change level)', async () => {
    const cache = { ...bare, loud: await analyzeLoudness(bare.dry, bare.wet, fs) };
    const a = renderOutput(cache, { strength: 0.2 }).lufs, b = renderOutput(cache, { strength: 1 }).lufs;
    expect(Math.abs(a - b)).toBeLessThan(0.5);
  });
  it('cached gain equals the measured gain (no re-measure needed)', async () => {
    const cache = { ...bare, loud: await analyzeLoudness(bare.dry, bare.wet, fs) };
    const withCache = renderOutput(cache, { strength: 0.4, targetLufs: -20, useLimiter: false }).gainDb;
    const measured = renderOutput(bare, { strength: 0.4, targetLufs: -20, useLimiter: false }).gainDb;
    expect(Math.abs(withCache - measured)).toBeLessThan(0.01);
  });
  it('preview window equals the same stretch of the full render when nothing is limited', async () => {
    const cache = { ...bare, loud: await analyzeLoudness(bare.dry, bare.wet, fs) };
    const opts = { strength: 0.6, targetLufs: -30 };
    const full = renderOutput(cache, opts).channels[0];
    const win = renderWindow(cache, opts, { startSec: 2, lengthSec: 3 });
    expect(win.channels[0].length).toBe(3 * fs);
    let maxErr = 0;
    for (let i = 0; i < win.channels[0].length; i++) maxErr = Math.max(maxErr, Math.abs(win.channels[0][i] - full[2 * fs + i]));
    expect(maxErr).toBeLessThan(1e-6);
    expect(win.startSec).toBe(2);
  });
  it('preview window clamps past the end of the file', async () => {
    const cache = { ...bare, loud: await analyzeLoudness(bare.dry, bare.wet, fs) };
    const win = renderWindow(cache, {}, { startSec: 10, lengthSec: 20 });
    expect(win.channels[0].length).toBe(2 * fs);
  });
});

describe('voice polish options', () => {
  it('suppression depth strengthens the model attenuation (gain^gamma) and is a no-op at gamma 1 / mask 1', async () => {
    const fs = 16000, n = fs * 5;
    const x = tone(1000, fs, n, 0.3);
    const run = async (model, depth) => (await enhanceFile({ channels: [x], sampleRate: fs, model, hpf: { enabled: false }, chunkSeconds: 5, depth })).wet[0];
    const ratio = async (model, depth) => toneAmp(await run(model, depth), 1000, fs, 16000, 64000) / 0.3;
    expect(Math.abs((await ratio(scaled(0.5), 1)) - 0.5)).toBeLessThan(0.02);
    const strong = await ratio(scaled(0.5), 1.4); // 0.5 * 0.5^0.4 = 0.379
    expect(strong).toBeGreaterThan(0.35);
    expect(strong).toBeLessThan(0.42);
    expect(Math.abs((await ratio(passthroughModel, 1.8)) - 1)).toBeLessThan(0.02);
  });

  it('echo reduction lowers the reverberant tail relative to speech, in proportion to the setting', async () => {
    const fs = 16000, n = fs * 5, dryS = new Float32Array(n);
    const starts = [0.3, 1.7, 3.1].map((s) => Math.round(s * fs));
    for (const s0 of starts) for (let i = 0; i < 0.5 * fs; i++) {
      const t = i / fs, f0 = 130 + 20 * Math.sin(2 * Math.PI * 3 * t);
      let v = 0;
      for (let h = 1; h <= 20; h++) v += (Math.sin(2 * Math.PI * h * f0 * t) / h) * Math.exp(-(((h * f0 - 800) / 1200) ** 2));
      dryS[s0 + i] = 0.3 * v * Math.min(1, i / 800, (0.5 * fs - i) / 800);
    }
    const rirLen = Math.round(0.5 * fs), rir = new Float32Array(rirLen);
    rir[0] = 1;
    const r = noise(rirLen, 1, 99);
    for (let i = 40; i < rirLen; i++) rir[i] = 0.35 * r[i] * Math.pow(10, (-3 * (i / fs)) / 0.6);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) { let a = 0; for (let j = 0; j < rirLen && j <= i; j++) a += dryS[i - j] * rir[j]; x[i] = a; }
    const measure = (y) => {
      let sp = 0, tl = 0;
      for (const s0 of starts) { sp += rms(y, s0 + 2000, s0 + 7000) ** 2; tl += rms(y, s0 + Math.round(0.62 * fs), s0 + Math.round(0.9 * fs)) ** 2; }
      return { speechDb: db(Math.sqrt(sp / 3)), tailToSpeech: db(Math.sqrt(tl / 3)) - db(Math.sqrt(sp / 3)) };
    };
    const run = async (rt60) => measure((await enhanceFile({ channels: [x], sampleRate: fs, model: passthroughModel, hpf: { enabled: false }, chunkSeconds: 5, rt60 })).wet[0]);
    const off = await run(0), low = await run(0.3), med = await run(0.5), high = await run(0.8);
    expect(med.tailToSpeech).toBeLessThan(off.tailToSpeech - 3);
    expect(low.tailToSpeech).toBeLessThan(off.tailToSpeech - 1);
    expect(high.tailToSpeech).toBeLessThan(med.tailToSpeech - 1.5);
    expect(off.speechDb - med.speechDb).toBeLessThan(2.5); // direct speech is not eaten
  });

  it('clarity EQ: +2.5 dB presence at 3.2 kHz, -1.5 dB at 250 Hz, near flat elsewhere; dry untouched', async () => {
    const { clarityMagnitudeDb } = await import('../../src/audio/postprocess.js');
    expect(Math.abs(clarityMagnitudeDb(3200, 48000) - 2.5)).toBeLessThan(0.6);
    expect(Math.abs(clarityMagnitudeDb(250, 48000) + 1.5)).toBeLessThan(0.3);
    expect(Math.abs(clarityMagnitudeDb(1000, 48000))).toBeLessThan(1.2);
    const fs = 48000, n = fs * 6;
    const x = tone(3200, fs, n, 0.2);
    const { wet, dry } = await enhanceFile({ channels: [x], sampleRate: fs, model: passthroughModel, hpf: { enabled: false }, chunkSeconds: 3, clarity: true });
    expect(Math.abs(toneAmp(wet[0], 3200, fs, 48000, 240000) / 0.2 - Math.pow(10, 2.5 / 20))).toBeLessThan(0.08);
    expect(toneAmp(dry[0], 3200, fs, 48000, 240000) / 0.2).toBeCloseTo(1, 2);
  });
});

describe('centre the voice (mono option)', () => {
  it('outputs identical channels with no side signal, keeps dry stereo untouched, mono input unaffected', async () => {
    const fs = 16000, n = fs * 5;
    const common = tone(500, fs, n, 0.2);
    const L = common.map((v, i) => v + 0.1 * Math.sin(i * 0.9)), R = common.map((v, i) => v - 0.1 * Math.sin(i * 0.9));
    const { dry, wet } = await enhanceFile({ channels: [L, R], sampleRate: fs, model: passthroughModel, hpf: { enabled: false }, chunkSeconds: 5, mono: true });
    expect(wet.length).toBe(2);
    expect(Array.from(wet[0])).toEqual(Array.from(wet[1]));
    expect(dry[0]).toBe(L);
    expect(dry[1]).toBe(R);
    // the out-of-phase 0.1 component (pure side signal) is gone from wet, the common tone stays
    expect(toneAmp(wet[0], 500, fs, 16000, 64000) / 0.2).toBeGreaterThan(0.95);
    const sideFreq = (0.9 * fs) / (2 * Math.PI);
    expect(toneAmp(wet[0], sideFreq, fs, 16000, 64000)).toBeLessThan(0.01);
    const m = await enhanceFile({ channels: [common], sampleRate: fs, model: passthroughModel, hpf: { enabled: false }, chunkSeconds: 5, mono: true });
    expect(m.wet.length).toBe(1);
  });
});
