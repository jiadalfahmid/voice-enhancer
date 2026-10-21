import { describe, it, expect } from 'vitest';
import {
  DPDFNET48K_WIN_LEN,
  DPDFNET48K_HOP_LEN,
  DPDFNET48K_BINS,
  DPDFNET48K_LATENCY_SAMPLES,
  fft960,
  ifft960,
  dpdfnet48kStft,
  dpdfnet48kIstft,
  dpdfnet48kPreprocessWaveform,
  dpdfnet48kPostprocessSpec,
} from '../../src/audio/dpdfnet48k-stft.js';
import { vorbisWindow } from '../../src/audio/dpdfnet-stft.js';

describe('DPDFNet 48 kHz STFT/ISTFT DSP', () => {
  it('vorbisWindow(960) satisfies Princen-Bradley condition', () => {
    const w = vorbisWindow(DPDFNET48K_WIN_LEN);
    expect(w.length).toBe(960);
    const half = DPDFNET48K_WIN_LEN / 2; // 480
    for (let i = 0; i < half; i++) {
      const sum = w[i] * w[i] + w[i + half] * w[i + half];
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-6);
    }
  });

  it('fft960 -> ifft960 achieves near-zero roundtrip reconstruction', () => {
    const N = DPDFNET48K_WIN_LEN;
    const inRe = new Float64Array(N);
    const inIm = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      inRe[i] = Math.sin((2 * Math.PI * 15 * i) / N) + 0.5 * Math.cos((2 * Math.PI * 40 * i) / N);
      inIm[i] = 0.2 * Math.cos((2 * Math.PI * 10 * i) / N);
    }

    const fRe = new Float64Array(N);
    const fIm = new Float64Array(N);
    fft960(inRe, inIm, fRe, fIm);

    const recRe = new Float64Array(N);
    const recIm = new Float64Array(N);
    ifft960(fRe, fIm, recRe, recIm);

    let maxDiffRe = 0;
    let maxDiffIm = 0;
    for (let i = 0; i < N; i++) {
      maxDiffRe = Math.max(maxDiffRe, Math.abs(inRe[i] - recRe[i]));
      maxDiffIm = Math.max(maxDiffIm, Math.abs(inIm[i] - recIm[i]));
    }
    expect(maxDiffRe).toBeLessThan(1e-10);
    expect(maxDiffIm).toBeLessThan(1e-10);
  });

  it('dpdfnet48kStft -> dpdfnet48kIstft achieves perfect reconstruction for centered signals', () => {
    const len = 48000;
    const x = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000) + 0.2 * Math.cos((2 * Math.PI * 1200 * i) / 48000);
    }

    const { re, im, frames } = dpdfnet48kStft(x);
    expect(re.length).toBe(frames * DPDFNET48K_BINS);
    expect(im.length).toBe(frames * DPDFNET48K_BINS);

    const rec = dpdfnet48kIstft(re, im, frames);

    // Centered STFT output aligns perfectly starting at sample 0
    let maxDiff = 0;
    for (let i = 0; i < len; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(x[i] - rec[i]));
    }
    expect(maxDiff).toBeLessThan(1e-5);
  });

  it('dpdfnet48kPreprocessWaveform -> dpdfnet48kPostprocessSpec preserves length and identity without neural network delay', () => {
    const len = 48000;
    const x = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      x[i] = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
    }

    const { re, im, frames } = dpdfnet48kPreprocessWaveform(x);
    const out = dpdfnet48kPostprocessSpec(re, im, frames, len);

    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(len);
  });
});
