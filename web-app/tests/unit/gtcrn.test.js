import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGtcrnModel, GTCRN_HOP } from '../../src/audio/gtcrn.js';
import { stft, istft } from '../../src/audio/stft.js';

const golden = JSON.parse(readFileSync(new URL('../fixtures/gtcrn_golden.json', import.meta.url), 'utf8'));
class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }

describe('GTCRN adapter plumbing (mock session replaying Python-ORT golden outputs)', () => {
  it('sends interleaved re/im frames and feeds each cache output back as the next cache input', async () => {
    const B = golden.bins, T = golden.T;
    const issued = []; // cache tensors the mock handed out
    let t = 0;
    const session = {
      async run(feeds) {
        // layout: mix [1,257,1,2] with re,im interleaved per bin
        expect(feeds.mix.dims).toEqual([1, 257, 1, 2]);
        for (let k = 0; k < B; k++) {
          expect(Math.abs(feeds.mix.data[2 * k] - golden.mixRe[t * B + k])).toBeLessThan(1e-6);
          expect(Math.abs(feeds.mix.data[2 * k + 1] - golden.mixIm[t * B + k])).toBeLessThan(1e-6);
        }
        if (t === 0) for (const n of ['conv_cache', 'tra_cache', 'inter_cache']) expect(feeds[n].data.every((v) => v === 0)).toBe(true);
        else for (const [n, i] of [['conv_cache', 0], ['tra_cache', 1], ['inter_cache', 2]]) expect(feeds[n]).toBe(issued[issued.length - 3 + i]);
        const enh = new Float32Array(B * 2);
        for (let k = 0; k < B; k++) { enh[2 * k] = golden.enhRe[t * B + k]; enh[2 * k + 1] = golden.enhIm[t * B + k]; }
        const mk = (dims) => new Tensor('float32', new Float32Array(dims.reduce((a, b) => a * b, 1)), dims);
        const c = [mk([2, 1, 16, 16, 33]), mk([2, 3, 1, 1, 16]), mk([2, 1, 33, 16])];
        issued.push(...c);
        t++;
        return { enh: new Tensor('float32', enh, [1, B, 1, 2]), conv_cache_out: c[0], tra_cache_out: c[1], inter_cache_out: c[2] };
      },
    };
    const model = createGtcrnModel({ Tensor }, session);
    expect(model.hop).toBe(256);
    const out = await model.process(Float32Array.from(golden.mixRe), Float32Array.from(golden.mixIm), T, model.createState());
    expect(t).toBe(T);
    for (let i = 0; i < out.re.length; i++) {
      expect(Math.abs(out.re[i] - golden.enhRe[i])).toBeLessThan(1e-6);
      expect(Math.abs(out.im[i] - golden.enhIm[i])).toBeLessThan(1e-6);
    }
  });
});

describe('STFT at hop 256 (GTCRN framing)', () => {
  for (const len of [16000, 16001, 1000, 100, 1]) {
    it(`perfect reconstruction, length ${len}`, () => {
      const x = Float32Array.from({ length: len }, (_, i) => Math.sin(i * 0.05) + 0.3 * Math.sin(i * 1.3));
      const { re, im, frames } = stft(x, GTCRN_HOP);
      const y = istft(re, im, frames, len, GTCRN_HOP);
      let maxErr = 0;
      for (let i = 0; i < len; i++) maxErr = Math.max(maxErr, Math.abs(x[i] - y[i]));
      expect(maxErr).toBeLessThan(1e-5);
    });
  }
  it('frame f is centred on sample f*256 (matches torch.stft center=True)', () => {
    const x = new Float32Array(4096); x[1024] = 1; // impulse exactly at the centre of frame 4
    const { re, im, frames } = stft(x, 256);
    const energy = (f) => { let e = 0; for (let k = 0; k < 257; k++) e += re[f * 257 + k] ** 2 + im[f * 257 + k] ** 2; return e; };
    let best = 0;
    for (let f = 1; f < frames; f++) if (energy(f) > energy(best)) best = f;
    expect(best).toBe(4);
  });
});
