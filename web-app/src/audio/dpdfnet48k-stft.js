// Dedicated STFT/ISTFT and DSP pipeline for DPDFNet 48 kHz (profile: dpdfnet2_48khz_hr).
// Operates with 960-point Vorbis window, 480-point hop, 481 frequency bins,
// and 3x320 Cooley-Tukey mixed-radix FFT.

import { vorbisWindow, fft320 } from './dpdfnet-stft.js';

export const DPDFNET48K_WIN_LEN = 960;
export const DPDFNET48K_HOP_LEN = 480;
export const DPDFNET48K_BINS = 481;
export const DPDFNET48K_LATENCY_SAMPLES = 1920; // 4 frames lookahead / delay (win_len * 2)

const DEFAULT_VORBIS_WINDOW_960 = vorbisWindow(DPDFNET48K_WIN_LEN);

// Precomputed recombination twiddles for 960-point FFT:
// W_960^k and W_960^(2k)
const TW_960_COS_1 = new Float64Array(DPDFNET48K_WIN_LEN);
const TW_960_SIN_1 = new Float64Array(DPDFNET48K_WIN_LEN);
const TW_960_COS_2 = new Float64Array(DPDFNET48K_WIN_LEN);
const TW_960_SIN_2 = new Float64Array(DPDFNET48K_WIN_LEN);
for (let k = 0; k < DPDFNET48K_WIN_LEN; k++) {
  const a1 = (-2 * Math.PI * k) / DPDFNET48K_WIN_LEN;
  TW_960_COS_1[k] = Math.cos(a1);
  TW_960_SIN_1[k] = Math.sin(a1);
  const a2 = (-4 * Math.PI * k) / DPDFNET48K_WIN_LEN;
  TW_960_COS_2[k] = Math.cos(a2);
  TW_960_SIN_2[k] = Math.sin(a2);
}

/**
 * 960-point forward FFT via 3x320 Cooley-Tukey decomposition.
 * @param {Float64Array|Float32Array} inRe
 * @param {Float64Array|Float32Array|null} inIm
 * @param {Float64Array} outRe
 * @param {Float64Array} outIm
 */
export function fft960(inRe, inIm, outRe, outIm) {
  const x0Re = new Float64Array(320), x0Im = new Float64Array(320);
  const x1Re = new Float64Array(320), x1Im = new Float64Array(320);
  const x2Re = new Float64Array(320), x2Im = new Float64Array(320);

  for (let n = 0; n < 320; n++) {
    x0Re[n] = inRe[3 * n];     x0Im[n] = inIm ? inIm[3 * n] : 0;
    x1Re[n] = inRe[3 * n + 1]; x1Im[n] = inIm ? inIm[3 * n + 1] : 0;
    x2Re[n] = inRe[3 * n + 2]; x2Im[n] = inIm ? inIm[3 * n + 2] : 0;
  }

  const X0Re = new Float64Array(320), X0Im = new Float64Array(320);
  const X1Re = new Float64Array(320), X1Im = new Float64Array(320);
  const X2Re = new Float64Array(320), X2Im = new Float64Array(320);

  fft320(x0Re, x0Im, X0Re, X0Im);
  fft320(x1Re, x1Im, X1Re, X1Im);
  fft320(x2Re, x2Im, X2Re, X2Im);

  for (let k = 0; k < 960; k++) {
    const m = k % 320;
    const c1 = TW_960_COS_1[k], s1 = TW_960_SIN_1[k];
    const c2 = TW_960_COS_2[k], s2 = TW_960_SIN_2[k];

    const r0 = X0Re[m], i0 = X0Im[m];
    const r1 = X1Re[m] * c1 - X1Im[m] * s1;
    const i1 = X1Re[m] * s1 + X1Im[m] * c1;
    const r2 = X2Re[m] * c2 - X2Im[m] * s2;
    const i2 = X2Re[m] * s2 + X2Im[m] * c2;

    outRe[k] = r0 + r1 + r2;
    outIm[k] = i0 + i1 + i2;
  }
}

/**
 * 960-point inverse IFFT via conjugate symmetry theorem:
 * IFFT(X) = (1/N) * conj(FFT(conj(X)))
 * @param {Float64Array} inRe
 * @param {Float64Array} inIm
 * @param {Float64Array} outRe
 * @param {Float64Array} outIm
 */
export function ifft960(inRe, inIm, outRe, outIm) {
  const conjIm = new Float64Array(960);
  for (let i = 0; i < 960; i++) conjIm[i] = -inIm[i];
  const tempRe = new Float64Array(960);
  const tempIm = new Float64Array(960);
  fft960(inRe, conjIm, tempRe, tempIm);
  for (let i = 0; i < 960; i++) {
    outRe[i] = tempRe[i] / 960;
    outIm[i] = -tempIm[i] / 960;
  }
}

/**
 * Centered STFT with reflect padding and Vorbis window (960 points, 480 hop).
 * @param {Float32Array} x - Input PCM waveform
 * @returns {{ re: Float32Array, im: Float32Array, frames: number }}
 */
export function dpdfnet48kStft(x) {
  const pad = DPDFNET48K_WIN_LEN / 2; // 480
  const n = x.length;
  if (n < pad) {
    throw new Error(`Input too short for DPDFNet 48k STFT: ${n} < ${pad}`);
  }

  // Reflect padding
  const padded = new Float32Array(n + 2 * pad);
  for (let i = 0; i < pad; i++) padded[i] = x[pad - i];
  padded.set(x, pad);
  for (let i = 0; i < pad; i++) padded[pad + n + i] = x[n - 2 - i];

  const frames = 1 + Math.floor(n / DPDFNET48K_HOP_LEN);
  const re = new Float32Array(frames * DPDFNET48K_BINS);
  const im = new Float32Array(frames * DPDFNET48K_BINS);

  const frameIn = new Float64Array(DPDFNET48K_WIN_LEN);
  const frameOutRe = new Float64Array(DPDFNET48K_WIN_LEN);
  const frameOutIm = new Float64Array(DPDFNET48K_WIN_LEN);

  for (let f = 0; f < frames; f++) {
    const start = f * DPDFNET48K_HOP_LEN;
    for (let i = 0; i < DPDFNET48K_WIN_LEN; i++) {
      frameIn[i] = padded[start + i] * DEFAULT_VORBIS_WINDOW_960[i];
    }
    fft960(frameIn, null, frameOutRe, frameOutIm);
    const destOffset = f * DPDFNET48K_BINS;
    for (let k = 0; k < DPDFNET48K_BINS; k++) {
      re[destOffset + k] = frameOutRe[k];
      im[destOffset + k] = frameOutIm[k];
    }
  }

  return { re, im, frames };
}

/**
 * Centered ISTFT with Vorbis synthesis window and overlap-add (960 points, 480 hop).
 * Trims leading centered pad (480 samples).
 * @param {Float32Array} re
 * @param {Float32Array} im
 * @param {number} nFrames
 * @returns {Float32Array}
 */
export function dpdfnet48kIstft(re, im, nFrames) {
  const totalSamples = (nFrames - 1) * DPDFNET48K_HOP_LEN + DPDFNET48K_WIN_LEN;
  const ola = new Float64Array(totalSamples);

  const inRe = new Float64Array(DPDFNET48K_WIN_LEN);
  const inIm = new Float64Array(DPDFNET48K_WIN_LEN);
  const outRe = new Float64Array(DPDFNET48K_WIN_LEN);
  const outIm = new Float64Array(DPDFNET48K_WIN_LEN);

  for (let f = 0; f < nFrames; f++) {
    const srcOffset = f * DPDFNET48K_BINS;
    for (let k = 0; k < DPDFNET48K_BINS; k++) {
      inRe[k] = re[srcOffset + k];
      inIm[k] = im[srcOffset + k];
    }
    // Conjugate symmetry for bins 481..959
    for (let k = DPDFNET48K_BINS; k < DPDFNET48K_WIN_LEN; k++) {
      inRe[k] = inRe[DPDFNET48K_WIN_LEN - k];
      inIm[k] = -inIm[DPDFNET48K_WIN_LEN - k];
    }

    ifft960(inRe, inIm, outRe, outIm);

    const start = f * DPDFNET48K_HOP_LEN;
    for (let i = 0; i < DPDFNET48K_WIN_LEN; i++) {
      ola[start + i] += outRe[i] * DEFAULT_VORBIS_WINDOW_960[i];
    }
  }

  const out = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) out[i] = ola[i];
  return out.subarray(DPDFNET48K_HOP_LEN);
}

/**
 * Preprocess waveform for DPDFNet 48 kHz: appends 960 zeros, then runs centered STFT.
 */
export function dpdfnet48kPreprocessWaveform(waveform) {
  const padded = new Float32Array(waveform.length + DPDFNET48K_WIN_LEN);
  padded.set(waveform);
  return dpdfnet48kStft(padded);
}

/**
 * Postprocess DPDFNet 48 kHz spectrum: runs ISTFT, discards first 1920 samples, and fits to target length.
 * @param {Float32Array} re
 * @param {Float32Array} im
 * @param {number} nFrames
 * @param {number} targetLength - Original waveform length
 * @returns {Float32Array}
 */
export function dpdfnet48kPostprocessSpec(re, im, nFrames, targetLength) {
  const raw = dpdfnet48kIstft(re, im, nFrames);
  const aligned = new Float32Array(Math.max(0, raw.length - DPDFNET48K_LATENCY_SAMPLES) + DPDFNET48K_LATENCY_SAMPLES);
  if (raw.length > DPDFNET48K_LATENCY_SAMPLES) {
    aligned.set(raw.subarray(DPDFNET48K_LATENCY_SAMPLES), 0);
  }

  if (aligned.length === targetLength) return aligned;
  const out = new Float32Array(targetLength);
  out.set(aligned.subarray(0, Math.min(targetLength, aligned.length)));
  return out;
}
