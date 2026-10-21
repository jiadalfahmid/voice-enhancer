// STFT / ISTFT per PRD section 6: FFT 512, hop 160 by default (GTCRN uses hop 256, so `hop` is a parameter), sqrt-Hann analysis + synthesis, 257 bins.
// Signal is padded with LATENCY zeros at the front (and back) so every real sample is covered by
// a full set of frames; ISTFT divides by the actual window-power sum (WOLA), giving perfect
// reconstruction when the spectrum is unmodified.

export const N_FFT = 512;
export const HOP = 160;
export const N_BINS = N_FFT / 2 + 1; // 257
export const LATENCY = N_FFT - HOP; // 352 samples (22 ms @ 16 kHz)

const LOG2N = 9;
const rev = new Uint16Array(N_FFT);
for (let i = 0; i < N_FFT; i++) {
  let r = 0;
  for (let b = 0; b < LOG2N; b++) if (i & (1 << b)) r |= 1 << (LOG2N - 1 - b);
  rev[i] = r;
}
const cosT = new Float64Array(N_FFT / 2);
const sinT = new Float64Array(N_FFT / 2);
for (let k = 0; k < N_FFT / 2; k++) {
  cosT[k] = Math.cos((2 * Math.PI * k) / N_FFT);
  sinT[k] = -Math.sin((2 * Math.PI * k) / N_FFT);
}

// periodic Hann, then sqrt for analysis/synthesis
const sqrtHann = new Float64Array(N_FFT);
for (let n = 0; n < N_FFT; n++) sqrtHann[n] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT));

function fft(re, im) {
  for (let i = 0; i < N_FFT; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= N_FFT; size <<= 1) {
    const half = size >> 1;
    const step = N_FFT / size;
    for (let start = 0; start < N_FFT; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cosT[k * step];
        const wi = sinT[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

export function frameCount(length, hop = HOP) {
  const total = length + 2 * (N_FFT - hop);
  return Math.max(1, Math.ceil((total - N_FFT) / hop) + 1);
}

/** @param {Float32Array} x @returns {{re: Float32Array, im: Float32Array, frames: number}} */
export function stft(x, hop = HOP) {
  const latency = N_FFT - hop;
  const frames = frameCount(x.length, hop);
  const padded = new Float64Array((frames - 1) * hop + N_FFT);
  padded.set(x, latency);
  const re = new Float32Array(frames * N_BINS);
  const im = new Float32Array(frames * N_BINS);
  const fr = new Float64Array(N_FFT);
  const fi = new Float64Array(N_FFT);
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let n = 0; n < N_FFT; n++) {
      fr[n] = padded[off + n] * sqrtHann[n];
      fi[n] = 0;
    }
    fft(fr, fi);
    const o = f * N_BINS;
    for (let k = 0; k < N_BINS; k++) {
      re[o + k] = fr[k];
      im[o + k] = fi[k];
    }
  }
  return { re, im, frames };
}

/** Inverse of stft(); `length` is the original signal length. */
export function istft(re, im, frames, length, hop = HOP) {
  const latency = N_FFT - hop;
  const outLen = (frames - 1) * hop + N_FFT;
  const out = new Float64Array(outLen);
  const wsum = new Float64Array(outLen);
  const fr = new Float64Array(N_FFT);
  const fi = new Float64Array(N_FFT);
  for (let f = 0; f < frames; f++) {
    const o = f * N_BINS;
    // Hermitian-symmetric spectrum; inverse FFT via conj -> forward FFT -> conj
    for (let k = 0; k < N_BINS; k++) {
      fr[k] = re[o + k];
      fi[k] = -im[o + k];
    }
    for (let k = N_BINS; k < N_FFT; k++) {
      fr[k] = re[o + N_FFT - k];
      fi[k] = im[o + N_FFT - k]; // conj of conj-symmetric partner, then conj again for inverse
    }
    fft(fr, fi);
    const base = f * hop;
    for (let n = 0; n < N_FFT; n++) {
      const w = sqrtHann[n];
      out[base + n] += (fr[n] / N_FFT) * w;
      wsum[base + n] += w * w;
    }
  }
  const y = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const p = i + latency;
    if (p < outLen) y[i] = out[p] / Math.max(wsum[p], 1e-8);
  }
  return y;
}
