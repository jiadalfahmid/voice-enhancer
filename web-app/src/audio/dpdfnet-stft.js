// Dedicated STFT/ISTFT and DSP pipeline for DPDFNet (16 kHz, FFT 320, hop 160, Vorbis window).
// Pure JavaScript, zero external dependencies, mixed-radix Cooley-Tukey (5x64) FFT.

export const DPDFNET_WIN_LEN = 320;
export const DPDFNET_HOP_LEN = 160;
export const DPDFNET_BINS = 161;
export const DPDFNET_LATENCY_SAMPLES = 640; // 4 frames lookahead/delay

// Precompute Vorbis window of length 320
export function vorbisWindow(windowLen = DPDFNET_WIN_LEN) {
  const windowSizeH = windowLen / 2;
  const w = new Float32Array(windowLen);
  for (let i = 0; i < windowLen; i++) {
    const s = Math.sin(0.5 * Math.PI * (i + 0.5) / windowSizeH);
    w[i] = Math.sin(0.5 * Math.PI * s * s);
  }
  return w;
}

const DEFAULT_VORBIS_WINDOW = vorbisWindow(DPDFNET_WIN_LEN);

// 64-point FFT bit-reversal lookup
const BIT_REV_64 = new Uint8Array(64);
for (let i = 0; i < 64; i++) {
  let rev = 0;
  for (let b = 0; b < 6; b++) rev = (rev << 1) | ((i >> b) & 1);
  BIT_REV_64[i] = rev;
}

// Precomputed twiddle tables for 64-point FFT and 320-point mixed-radix
const TW_64_COS = new Float64Array(32);
const TW_64_SIN = new Float64Array(32);
for (let k = 0; k < 32; k++) {
  const angle = (-2 * Math.PI * k) / 64;
  TW_64_COS[k] = Math.cos(angle);
  TW_64_SIN[k] = Math.sin(angle);
}

// 5-point DFT twiddles W5^(n1 * k1)
const W5_COS = new Float64Array(25);
const W5_SIN = new Float64Array(25);
for (let n1 = 0; n1 < 5; n1++) {
  for (let k1 = 0; k1 < 5; k1++) {
    const angle = (-2 * Math.PI * n1 * k1) / 5;
    W5_COS[n1 * 5 + k1] = Math.cos(angle);
    W5_SIN[n1 * 5 + k1] = Math.sin(angle);
  }
}

// 320 twiddles W_320^(k1 * n2) for k1 in 0..4, n2 in 0..63
const TW_320_COS = new Float64Array(5 * 64);
const TW_320_SIN = new Float64Array(5 * 64);
for (let k1 = 0; k1 < 5; k1++) {
  for (let n2 = 0; n2 < 64; n2++) {
    const angle = (-2 * Math.PI * k1 * n2) / 320;
    TW_320_COS[k1 * 64 + n2] = Math.cos(angle);
    TW_320_SIN[k1 * 64 + n2] = Math.sin(angle);
  }
}

/** In-place radix-2 64-point FFT on Float64Array buffers */
function fft64InPlace(re, im, offset, inverse = false) {
  // Bit-reversal permutation
  for (let i = 0; i < 64; i++) {
    const j = BIT_REV_64[i];
    if (i < j) {
      const tr = re[offset + i]; re[offset + i] = re[offset + j]; re[offset + j] = tr;
      const ti = im[offset + i]; im[offset + i] = im[offset + j]; im[offset + j] = ti;
    }
  }

  // 6 butterfly stages: size = 2, 4, 8, 16, 32, 64
  for (let len = 2; len <= 64; len <<= 1) {
    const half = len >> 1;
    const step = 64 / len;
    for (let i = 0; i < 64; i += len) {
      for (let j = 0; j < half; j++) {
        const k = j * step;
        const cos = TW_64_COS[k];
        const sin = inverse ? -TW_64_SIN[k] : TW_64_SIN[k];
        const uRe = re[offset + i + j];
        const uIm = im[offset + i + j];
        const vRe = re[offset + i + j + half];
        const vIm = im[offset + i + j + half];

        const tRe = vRe * cos - vIm * sin;
        const tIm = vRe * sin + vIm * cos;

        re[offset + i + j] = uRe + tRe;
        im[offset + i + j] = uIm + tIm;
        re[offset + i + j + half] = uRe - tRe;
        im[offset + i + j + half] = uIm - tIm;
      }
    }
  }
}

/**
 * 320-point mixed-radix FFT (5 x 64).
 * @param {Float64Array|Float32Array} inRe
 * @param {Float64Array|Float32Array} inIm
 * @param {Float64Array} outRe
 * @param {Float64Array} outIm
 * @param {boolean} inverse
 */
export function fft320(inRe, inIm, outRe, outIm, inverse = false) {
  // Scratch buffer for 5 x 64 intermediate matrix
  // Step 1: 64 column-wise 5-point DFTs
  const yRe = new Float64Array(5 * 64);
  const yIm = new Float64Array(5 * 64);

  for (let n2 = 0; n2 < 64; n2++) {
    for (let k1 = 0; k1 < 5; k1++) {
      let sumRe = 0;
      let sumIm = 0;
      for (let n1 = 0; n1 < 5; n1++) {
        const xRe = inRe[n1 * 64 + n2];
        const xIm = inIm ? inIm[n1 * 64 + n2] : 0;
        const wIdx = n1 * 5 + k1;
        const cos = W5_COS[wIdx];
        const sin = inverse ? -W5_SIN[wIdx] : W5_SIN[wIdx];
        sumRe += xRe * cos - xIm * sin;
        sumIm += xRe * sin + xIm * cos;
      }
      yRe[k1 * 64 + n2] = sumRe;
      yIm[k1 * 64 + n2] = sumIm;
    }
  }

  // Step 2: Multiply by twiddle factors W_320^(k1 * n2)
  for (let k1 = 0; k1 < 5; k1++) {
    const rowOffset = k1 * 64;
    for (let n2 = 0; n2 < 64; n2++) {
      const twIdx = rowOffset + n2;
      const cos = TW_320_COS[twIdx];
      const sin = inverse ? -TW_320_SIN[twIdx] : TW_320_SIN[twIdx];
      const yr = yRe[rowOffset + n2];
      const yi = yIm[rowOffset + n2];
      yRe[rowOffset + n2] = yr * cos - yi * sin;
      yIm[rowOffset + n2] = yr * sin + yi * cos;
    }
    // Step 3: 64-point FFT along each row k1
    fft64InPlace(yRe, yIm, rowOffset, inverse);
  }

  // Step 4: Map to output index k = k2 * 5 + k1
  const scale = inverse ? 1 / 320 : 1;
  for (let k1 = 0; k1 < 5; k1++) {
    const rowOffset = k1 * 64;
    for (let k2 = 0; k2 < 64; k2++) {
      const outIdx = k2 * 5 + k1;
      outRe[outIdx] = yRe[rowOffset + k2] * scale;
      outIm[outIdx] = yIm[rowOffset + k2] * scale;
    }
  }
}

/**
 * Centered reflect padding matching librosa/PyTorch pad_mode='reflect' with pad_width = 160.
 * For length L, prepends 160 samples and appends 160 samples.
 */
export function padReflect(x, padLen = DPDFNET_HOP_LEN) {
  const L = x.length;
  const out = new Float32Array(L + 2 * padLen);
  out.set(x, padLen);

  if (L === 1) {
    // Single sample edge-case: replicate
    out.fill(x[0]);
    return out;
  }

  // Left reflect pad: elements before index 0 reflect x[1], x[2], ... without repeating x[0]
  for (let i = 0; i < padLen; i++) {
    const period = 2 * (L - 1);
    let idx = (1 + i) % period;
    if (idx >= L) idx = period - idx;
    out[padLen - 1 - i] = x[idx];
  }

  // Right reflect pad: elements after index L - 1 reflect x[L - 2], x[L - 3], ...
  for (let i = 0; i < padLen; i++) {
    const period = 2 * (L - 1);
    let idx = (L - 2 - i) % period;
    while (idx < 0) idx += period;
    if (idx >= L) idx = period - idx;
    out[padLen + L + i] = x[idx];
  }

  return out;
}

/**
 * Centered STFT with Vorbis window, 320-point FFT, 160 hop.
 * @param {Float32Array} x - Input audio waveform (should be pre-padded with 320 zeros at the end if matching DPDFNet)
 * @param {Float32Array} [win] - Vorbis window (default: 320-point Vorbis)
 * @returns {{re: Float32Array, im: Float32Array, frames: number, bins: number}}
 */
export function dpdfnetStft(x, win = DEFAULT_VORBIS_WINDOW) {
  const padded = padReflect(x, DPDFNET_HOP_LEN);
  const nFrames = 1 + Math.floor((padded.length - DPDFNET_WIN_LEN) / DPDFNET_HOP_LEN);
  const re = new Float32Array(nFrames * DPDFNET_BINS);
  const im = new Float32Array(nFrames * DPDFNET_BINS);

  const frameIn = new Float64Array(DPDFNET_WIN_LEN);
  const fftRe = new Float64Array(DPDFNET_WIN_LEN);
  const fftIm = new Float64Array(DPDFNET_WIN_LEN);

  for (let t = 0; t < nFrames; t++) {
    const start = t * DPDFNET_HOP_LEN;
    for (let i = 0; i < DPDFNET_WIN_LEN; i++) {
      frameIn[i] = padded[start + i] * win[i];
    }

    fft320(frameIn, null, fftRe, fftIm, false);

    const outOffset = t * DPDFNET_BINS;
    for (let k = 0; k < DPDFNET_BINS; k++) {
      re[outOffset + k] = fftRe[k];
      im[outOffset + k] = fftIm[k];
    }
  }

  return { re, im, frames: nFrames, bins: DPDFNET_BINS };
}

/**
 * Centered ISTFT with Vorbis synthesis window and overlap-add normalization.
 * @param {Float32Array} re - Flattened real components [frames * 161]
 * @param {Float32Array} im - Flattened imag components [frames * 161]
 * @param {number} nFrames
 * @param {Float32Array} [win]
 * @returns {Float32Array} Time-domain reconstructed audio (before 640-sample alignment trimming)
 */
export function dpdfnetIstft(re, im, nFrames, win = DEFAULT_VORBIS_WINDOW) {
  const fullLen = (nFrames - 1) * DPDFNET_HOP_LEN + DPDFNET_WIN_LEN;
  const out = new Float32Array(fullLen);
  const norm = new Float32Array(fullLen);

  const fullRe = new Float64Array(DPDFNET_WIN_LEN);
  const fullIm = new Float64Array(DPDFNET_WIN_LEN);
  const ifftRe = new Float64Array(DPDFNET_WIN_LEN);
  const ifftIm = new Float64Array(DPDFNET_WIN_LEN);

  for (let t = 0; t < nFrames; t++) {
    const inOffset = t * DPDFNET_BINS;
    // Hermitian symmetry reconstruction
    fullRe[0] = re[inOffset];
    fullIm[0] = 0;
    fullRe[DPDFNET_HOP_LEN] = re[inOffset + DPDFNET_HOP_LEN];
    fullIm[DPDFNET_HOP_LEN] = 0;

    for (let k = 1; k < DPDFNET_HOP_LEN; k++) {
      const r = re[inOffset + k];
      const m = im[inOffset + k];
      fullRe[k] = r;
      fullIm[k] = m;
      fullRe[DPDFNET_WIN_LEN - k] = r;
      fullIm[DPDFNET_WIN_LEN - k] = -m;
    }

    fft320(fullRe, fullIm, ifftRe, ifftIm, true);

    const start = t * DPDFNET_HOP_LEN;
    for (let i = 0; i < DPDFNET_WIN_LEN; i++) {
      const w = win[i];
      out[start + i] += ifftRe[i] * w;
      norm[start + i] += w * w;
    }
  }

  // Normalize by overlap-add squared window sum
  for (let i = 0; i < fullLen; i++) {
    if (norm[i] > 1e-8) {
      out[i] /= norm[i];
    }
  }

  // Center trim: remove the first hop length (160 samples) corresponding to center=True reflect padding
  return out.subarray(DPDFNET_HOP_LEN);
}

/**
 * Fits array to exact length by slicing or zero-padding.
 */
export function fitLength(y, len) {
  if (y.length === len) return y;
  const out = new Float32Array(len);
  out.set(y.subarray(0, Math.min(len, y.length)));
  return out;
}

/**
 * Preprocess waveform for DPDFNet: appends 320 zeros, then runs centered STFT.
 */
export function dpdfnetPreprocessWaveform(waveform) {
  const padded = new Float32Array(waveform.length + DPDFNET_WIN_LEN);
  padded.set(waveform);
  return dpdfnetStft(padded);
}

/**
 * Postprocess DPDFNet spectrum: runs ISTFT, discards first 640 samples, appends 640 zeros, and fits to target length.
 * @param {Float32Array} re
 * @param {Float32Array} im
 * @param {number} nFrames
 * @param {number} targetLength - Original waveform length
 * @returns {Float32Array}
 */
export function dpdfnetPostprocessSpec(re, im, nFrames, targetLength) {
  const raw = dpdfnetIstft(re, im, nFrames);
  // Discard first 640 samples and append 640 zeros
  const aligned = new Float32Array(Math.max(0, raw.length - DPDFNET_LATENCY_SAMPLES) + DPDFNET_LATENCY_SAMPLES);
  if (raw.length > DPDFNET_LATENCY_SAMPLES) {
    aligned.set(raw.subarray(DPDFNET_LATENCY_SAMPLES), 0);
  }
  return fitLength(aligned, targetLength);
}
