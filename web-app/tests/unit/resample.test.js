import { describe, it, expect } from 'vitest';
import { resample } from '../../src/audio/resample.js';

const tone = (f, fs, n, a = 0.5) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / fs));
const rmsMid = (x, trim) => {
  let s = 0, c = 0;
  for (let i = trim; i < x.length - trim; i++) { s += x[i] * x[i]; c++; }
  return Math.sqrt(s / c);
};
const db = (v) => 20 * Math.log10(v);

describe('resample', () => {
  it('output length = ceil(len * to / from)', () => {
    expect(resample(new Float32Array(48000), 48000, 16000).length).toBe(16000);
    expect(resample(new Float32Array(44100), 44100, 16000).length).toBe(16000);
    expect(resample(new Float32Array(16001), 16000, 48000).length).toBe(48003);
  });
  it('identity when rates match', () => {
    const x = tone(440, 16000, 100);
    expect(Array.from(resample(x, 16000, 16000))).toEqual(Array.from(x));
  });
  it('preserves DC', () => {
    const y = resample(new Float32Array(9600).fill(0.3), 48000, 16000);
    expect(y[2000]).toBeCloseTo(0.3, 5);
  });
  it('48k -> 16k keeps a 1 kHz tone amplitude (< 0.05 dB) and zero delay', () => {
    const y = resample(tone(1000, 48000, 48000), 48000, 16000);
    const ref = tone(1000, 16000, 16000);
    expect(Math.abs(db(rmsMid(y, 500) / rmsMid(ref, 500)))).toBeLessThan(0.05);
    let maxErr = 0;
    for (let i = 500; i < 15500; i++) maxErr = Math.max(maxErr, Math.abs(y[i] - ref[i]));
    expect(maxErr).toBeLessThan(2e-3);
  });
  it('48k -> 16k rejects a 10 kHz tone (> 60 dB)', () => {
    const y = resample(tone(10000, 48000, 48000), 48000, 16000);
    expect(db(rmsMid(y, 500) / (0.5 / Math.SQRT2))).toBeLessThan(-60);
  });
  it('44.1k -> 16k keeps a 2 kHz tone', () => {
    const y = resample(tone(2000, 44100, 44100), 44100, 16000);
    const ref = tone(2000, 16000, y.length);
    let maxErr = 0;
    for (let i = 500; i < y.length - 500; i++) maxErr = Math.max(maxErr, Math.abs(y[i] - ref[i]));
    expect(maxErr).toBeLessThan(2e-3);
  });
  it('48k -> 16k -> 48k round trip of a 3 kHz tone', () => {
    const x = tone(3000, 48000, 48000);
    const y = resample(resample(x, 48000, 16000), 16000, 48000);
    let maxErr = 0;
    for (let i = 2000; i < 46000; i++) maxErr = Math.max(maxErr, Math.abs(y[i] - x[i]));
    expect(maxErr).toBeLessThan(3e-3);
  });
});
