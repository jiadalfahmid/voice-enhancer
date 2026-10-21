import { describe, it, expect } from 'vitest';
import { resample } from '../../src/audio/resample.js';
import { resampleChunked } from '../../src/audio/resample-async.js';

function sig(n) { return Float32Array.from({ length: n }, (_, i) => 0.4 * Math.sin(i * 0.031) + 0.2 * Math.sin(i * 0.57) + 0.05 * Math.sin(i * 1.9)); }

describe('resampleChunked', () => {
  for (const [from, to, sec] of [[44100, 16000, 31], [48000, 16000, 27], [16000, 48000, 33], [48000, 44100, 25]]) {
    it(`equals one-shot resample, ${from} -> ${to}`, async () => {
      const x = sig(Math.round(from * sec) + 17);
      const a = resample(x, from, to);
      const b = await resampleChunked(x, from, to, { blockSeconds: 4 });
      expect(b.length).toBe(a.length);
      let maxErr = 0;
      for (let i = 0; i < a.length; i++) maxErr = Math.max(maxErr, Math.abs(a[i] - b[i]));
      expect(maxErr).toBeLessThan(1e-6);
    });
  }
  it('check() can abort between blocks', async () => {
    let threw = false;
    let n = 0;
    try { await resampleChunked(sig(48000 * 30), 48000, 16000, { blockSeconds: 2, check: () => { if (++n > 3) throw new Error('stop'); } }); } catch { threw = true; }
    expect(threw).toBe(true);
    expect(n).toBe(4);
  });
});
