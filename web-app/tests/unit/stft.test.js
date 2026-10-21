import { describe, it, expect } from 'vitest';
import { stft, istft, N_BINS, HOP } from '../../src/audio/stft.js';

function noise(n, seed = 1) {
  const x = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    x[i] = (s / 2 ** 32) * 2 - 1;
  }
  return x;
}
const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
function errDb(a, b) {
  const d = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) d[i] = a[i] - b[i];
  return 20 * Math.log10(rms(d) / rms(a) + 1e-30);
}

describe('STFT/ISTFT', () => {
  for (const len of [16000, 16001, 48123, 1000, 100, 1]) {
    it(`perfect reconstruction with mask=1, length ${len} (< -90 dB)`, () => {
      const x = noise(len, len);
      const { re, im, frames } = stft(x);
      expect(re.length).toBe(frames * N_BINS);
      const y = istft(re, im, frames, len);
      expect(y.length).toBe(len);
      expect(errDb(x, y)).toBeLessThan(-90);
    });
  }
  it('mask=0 gives silence', () => {
    const x = noise(8000);
    const { re, im, frames } = stft(x);
    re.fill(0); im.fill(0);
    expect(rms(istft(re, im, frames, x.length))).toBe(0);
  });
  it('frame hop is 160', () => expect(HOP).toBe(160));
  it('pure tone lands in the right bin', () => {
    const x = new Float32Array(8000);
    for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 1000 * i) / 16000);
    const { re, im, frames } = stft(x);
    const f = Math.floor(frames / 2);
    let best = 0, bi = 0;
    for (let k = 0; k < N_BINS; k++) {
      const m = Math.hypot(re[f * N_BINS + k], im[f * N_BINS + k]);
      if (m > best) { best = m; bi = k; }
    }
    expect(bi).toBe(32); // 1000 Hz / (16000/512)
  });
});
