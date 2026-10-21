import { describe, it, expect } from 'vitest';
import { highPass, hpfMagnitudeDb } from '../../src/audio/hpf.js';
import { integratedLufs, normalizeToLufs } from '../../src/audio/lufs.js';
import { limit } from '../../src/audio/limiter.js';
import { resample } from '../../src/audio/resample.js';
import { mixDryWet } from '../../src/audio/mixer.js';
import { encodeWav } from '../../src/audio/encode-wav.js';

const tone = (f, fs, n, a) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / fs));
const dbfs = (db) => Math.pow(10, db / 20);

describe('HPF', () => {
  it('-3 dB at 80 Hz, 12 dB/oct', () => {
    expect(hpfMagnitudeDb(80, 48000)).toBeCloseTo(-3.01, 1);
    const slope = hpfMagnitudeDb(10, 48000) - hpfMagnitudeDb(20, 48000);
    expect(slope).toBeGreaterThan(-12.5);
    expect(slope).toBeLessThan(-11.0);
  });
  it('bypass is bit-exact (same buffer)', () => {
    const x = tone(440, 48000, 1000, 0.5);
    expect(highPass(x, 48000, { enabled: false })).toBe(x);
  });
});

describe('LUFS', () => {
  it('EBU 3341 case 1: stereo 1 kHz at -23 dBFS reads -23.0 LUFS (+-0.1)', () => {
    const x = tone(1000, 48000, 48000 * 20, dbfs(-23));
    expect(Math.abs(integratedLufs([x, x], 48000) + 23)).toBeLessThan(0.1);
  });
  it('normalizes to target within +-0.5 LU', () => {
    const x = tone(440, 48000, 48000 * 15, 0.05);
    const { channels } = normalizeToLufs([x], 48000, -16);
    expect(Math.abs(integratedLufs(channels, 48000) + 16)).toBeLessThan(0.5);
  });
  it('gating ignores silence', () => {
    const n = 48000 * 10;
    const x = new Float32Array(n * 2);
    x.set(tone(1000, 48000, n, dbfs(-23)));
    const full = integratedLufs([tone(1000, 48000, n, dbfs(-23))], 48000);
    expect(Math.abs(integratedLufs([x], 48000) - full)).toBeLessThan(0.1);
  });
});

describe('limiter', () => {
  const fs = 48000;
  function truePeak(x) {
    const up = resample(x, fs, fs * 4);
    return up.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  }
  it('stress clip: nothing above -1 dBTP ceiling (independent 4x measure)', () => {
    const n = fs * 2;
    const x = tone(997, fs, n, 1.8);
    for (let i = 20000; i < 20050; i++) x[i] = 3; // spike
    for (let i = 60000; i < 60100; i++) x[i] = i % 2 ? 2.5 : -2.5; // fs/2-ish burst
    const { channels } = limit([x], fs);
    expect(truePeak(channels[0])).toBeLessThan(dbfs(-1) * 1.01);
  });
  it('normal speech-level signal: <= 1 dB gain reduction', () => {
    const x = tone(300, fs, fs * 2, dbfs(-6));
    const { maxGainReductionDb } = limit([x], fs);
    expect(maxGainReductionDb).toBeLessThanOrEqual(1);
  });
  it('output is time aligned with input below ceiling', () => {
    const x = tone(300, fs, fs, dbfs(-20));
    const { channels } = limit([x], fs);
    for (let i = 0; i < x.length; i += 997) expect(channels[0][i]).toBeCloseTo(x[i], 6);
  });
});

describe('mixer', () => {
  it('0% strength is the dry input (null test)', () => {
    const d = tone(440, 16000, 1000, 0.5), w = tone(880, 16000, 1000, 0.5);
    expect(Array.from(mixDryWet([d], [w], 0)[0])).toEqual(Array.from(d));
  });
  it('100% strength is the wet signal', () => {
    const d = tone(440, 16000, 1000, 0.5), w = tone(880, 16000, 1000, 0.5);
    expect(Array.from(mixDryWet([d], [w], 1)[0])).toEqual(Array.from(w));
  });
  it('dry path is delayed by dryDelay samples', () => {
    const d = Float32Array.from({ length: 100 }, (_, i) => i + 1), w = new Float32Array(100);
    const y = mixDryWet([d], [w], 0, 10)[0];
    expect(y[10]).toBe(1);
    expect(y[9]).toBe(0);
  });
});

describe('WAV encoder', () => {
  it('writes a valid 16-bit header and samples', () => {
    const b = encodeWav([Float32Array.from([0, 1, -1, 0.5])], 16000, 16);
    const dv = new DataView(b.buffer);
    expect(b.length).toBe(44 + 8);
    expect(dv.getUint32(24, true)).toBe(16000);
    expect(dv.getUint16(34, true)).toBe(16);
    expect(dv.getInt16(46, true)).toBe(32767);
    expect(dv.getInt16(48, true)).toBe(-32768);
  });
  it('24-bit stereo size and frame count', () => {
    const c = [new Float32Array(100), new Float32Array(100)];
    const b = encodeWav(c, 48000, 24);
    expect(b.length).toBe(44 + 100 * 2 * 3);
  });
});
