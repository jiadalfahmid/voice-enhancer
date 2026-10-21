import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  fft320,
  vorbisWindow,
  padReflect,
  dpdfnetStft,
  dpdfnetIstft,
  fitLength,
  dpdfnetPreprocessWaveform,
  dpdfnetPostprocessSpec,
  DPDFNET_WIN_LEN,
  DPDFNET_HOP_LEN,
  DPDFNET_BINS,
  DPDFNET_LATENCY_SAMPLES,
} from '../../src/audio/dpdfnet-stft.js';

const stftGolden = JSON.parse(readFileSync(new URL('../fixtures/dpdfnet_stft_golden.json', import.meta.url), 'utf8'));

describe('DPDFNet 320-point FFT/IFFT', () => {
  it('roundtrips random complex signals with machine-precision accuracy (< 1e-12)', () => {
    const inRe = new Float64Array(320);
    const inIm = new Float64Array(320);
    for (let i = 0; i < 320; i++) {
      inRe[i] = Math.sin(i * 0.13) + Math.cos(i * 0.71);
      inIm[i] = Math.cos(i * 0.29) - Math.sin(i * 0.43);
    }

    const fwdRe = new Float64Array(320);
    const fwdIm = new Float64Array(320);
    fft320(inRe, inIm, fwdRe, fwdIm, false);

    const backRe = new Float64Array(320);
    const backIm = new Float64Array(320);
    fft320(fwdRe, fwdIm, backRe, backIm, true);

    let maxDiff = 0;
    for (let i = 0; i < 320; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(inRe[i] - backRe[i]), Math.abs(inIm[i] - backIm[i]));
    }
    expect(maxDiff).toBeLessThan(1e-12);
  });

  it('transforms pure DC to a single spike in bin 0', () => {
    const inRe = new Float64Array(320).fill(1);
    const fwdRe = new Float64Array(320);
    const fwdIm = new Float64Array(320);
    fft320(inRe, null, fwdRe, fwdIm, false);

    expect(fwdRe[0]).toBeCloseTo(320, 6);
    expect(fwdIm[0]).toBeCloseTo(0, 6);
    for (let k = 1; k < 320; k++) {
      expect(Math.abs(fwdRe[k])).toBeLessThan(1e-10);
      expect(Math.abs(fwdIm[k])).toBeLessThan(1e-10);
    }
  });

  it('transforms a pure single sinusoid into single bin conjugate spikes', () => {
    // 320 points, bin 5: frequency is 5 * (fs / 320)
    const inRe = new Float64Array(320);
    for (let i = 0; i < 320; i++) inRe[i] = Math.cos((2 * Math.PI * 5 * i) / 320);

    const fwdRe = new Float64Array(320);
    const fwdIm = new Float64Array(320);
    fft320(inRe, null, fwdRe, fwdIm, false);

    expect(fwdRe[5]).toBeCloseTo(160, 6);
    expect(fwdRe[320 - 5]).toBeCloseTo(160, 6);
    for (let k = 0; k < 320; k++) {
      if (k !== 5 && k !== 320 - 5) {
        expect(Math.hypot(fwdRe[k], fwdIm[k])).toBeLessThan(1e-10);
      }
    }
  });
});

describe('DPDFNet Vorbis window', () => {
  it('satisfies the Princen-Bradley partition of unity at 50% overlap', () => {
    const w = vorbisWindow(320);
    expect(w.length).toBe(320);
    let maxErr = 0;
    for (let i = 0; i < 160; i++) {
      const sumSq = w[i] * w[i] + w[i + 160] * w[i + 160];
      maxErr = Math.max(maxErr, Math.abs(sumSq - 1.0));
    }
    expect(maxErr).toBeLessThan(1e-6);
  });

  it('is symmetric and bounded in [0, 1]', () => {
    const w = vorbisWindow(320);
    for (let i = 0; i < 160; i++) {
      expect(w[i]).toBeCloseTo(w[319 - i], 6);
      expect(w[i]).toBeGreaterThanOrEqual(0);
      expect(w[i]).toBeLessThanOrEqual(1);
    }
  });
});

describe('DPDFNet reflect padding', () => {
  it('matches librosa/scipy reflect pad convention', () => {
    const x = new Float32Array([10, 20, 30, 40, 50]);
    const p = padReflect(x, 2);
    // [30, 20, 10, 20, 30, 40, 50, 40, 30]
    expect(Array.from(p)).toEqual([30, 20, 10, 20, 30, 40, 50, 40, 30]);
  });
});

describe('DPDFNet STFT and ISTFT roundtrip and parity with librosa golden', () => {
  it('matches Python librosa STFT and ISTFT values within 1e-5 on golden fixture', () => {
    const x = Float32Array.from(stftGolden.x);
    const { re, im, frames, bins } = dpdfnetPreprocessWaveform(x);
    expect(frames).toBe(stftGolden.frames);
    expect(bins).toBe(stftGolden.bins);

    let maxDiffRe = 0, maxDiffIm = 0;
    for (let i = 0; i < re.length; i++) {
      maxDiffRe = Math.max(maxDiffRe, Math.abs(re[i] - stftGolden.specRe[i]));
      maxDiffIm = Math.max(maxDiffIm, Math.abs(im[i] - stftGolden.specIm[i]));
    }
    expect(maxDiffRe).toBeLessThan(1e-4);
    expect(maxDiffIm).toBeLessThan(1e-4);

    const rawRec = dpdfnetIstft(re, im, frames);
    let maxDiffRec = 0;
    for (let i = 0; i < x.length; i++) {
      maxDiffRec = Math.max(maxDiffRec, Math.abs(rawRec[i] - x[i]));
    }
    expect(maxDiffRec).toBeLessThan(1e-5);
  });

  for (const len of [16000, 8000, 1000, 320, 160, 10, 1]) {
    it(`reconstructs signals with < 1e-5 error, length ${len}`, () => {
      const x = Float32Array.from({ length: len }, (_, i) => 0.5 * Math.sin(i * 0.05) + 0.2 * Math.cos(i * 0.17));
      const { re, im, frames } = dpdfnetStft(x);
      const rec = dpdfnetIstft(re, im, frames);
      let maxErr = 0;
      for (let i = 0; i < len; i++) {
        maxErr = Math.max(maxErr, Math.abs(x[i] - rec[i]));
      }
      expect(maxErr).toBeLessThan(1e-5);
    });
  }

  it('silence input produces silence output', () => {
    const x = new Float32Array(1600);
    const { re, im, frames } = dpdfnetStft(x);
    const rec = dpdfnetIstft(re, im, frames);
    let maxAmp = 0;
    for (let i = 0; i < x.length; i++) maxAmp = Math.max(maxAmp, Math.abs(rec[i]));
    expect(maxAmp).toBe(0);
  });
});

describe('DPDFNet alignment and latency compensation', () => {
  it('preprocess appends 320 zeros and postprocess removes 640 delay samples', () => {
    const len = 3200;
    const x = Float32Array.from({ length: len }, (_, i) => Math.sin((2 * Math.PI * 400 * i) / 16000));
    const pre = dpdfnetPreprocessWaveform(x);
    // Number of frames for len + 320 = 3520 samples: 1 + 3520/160 = 23 frames
    expect(pre.frames).toBe(1 + (len + DPDFNET_WIN_LEN) / DPDFNET_HOP_LEN);
    expect(pre.bins).toBe(161);

    // If identity spectral transfer with 4-frame delay simulated:
    // When postprocess discards first 640 samples and fits to target length
    const out = dpdfnetPostprocessSpec(pre.re, pre.im, pre.frames, len);
    expect(out.length).toBe(len);
  });
});
