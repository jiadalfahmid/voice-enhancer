// Optional "voice polish" stages applied to the model output spectrum (process-time, baked into `wet`).
import { N_BINS } from './stft.js';

/**
 * Suppression depth: scale the enhanced spectrum by (|E|/|M|)^(gamma-1), i.e. raise the model's gain to the
 * power gamma. gamma 1 = untouched, >1 = the model's attenuation is applied more strongly. In place on E.
 */
export function applyDepth(E, M, T, gamma) {
  if (!(gamma > 1)) return;
  const n = T * N_BINS;
  for (let i = 0; i < n; i++) {
    const me = Math.hypot(E.re[i], E.im[i]);
    const mm = Math.hypot(M.re[i], M.im[i]);
    const r = mm > 1e-9 ? Math.min(1, me / mm) : 1;
    const s = Math.pow(r, gamma - 1);
    E.re[i] *= s; E.im[i] *= s;
  }
}

/**
 * Late-reverberation suppression (Lebart-style spectral subtraction). The late tail at frame t is predicted
 * from the observed power `delayFrames` earlier, decayed by the room's RT60; it is subtracted from the
 * current power and the resulting gain (smoothed) is applied. In place on E.
 */
export function suppressLateReverb(E, T, { rt60, hop, sampleRate = 16000, beta = 1.2, gmin = 0.12, delayMs = 48 }) {
  if (!(rt60 > 0)) return;
  const D = Math.max(1, Math.round((delayMs / 1000) * sampleRate / hop));
  const tau = (D * hop) / sampleRate;
  const a = Math.pow(10, (-6 * tau) / rt60); // power decay over tau for a 60 dB / rt60 decay
  const P = new Float32Array(T * N_BINS);
  for (let t = 0; t < T; t++) {
    const o = t * N_BINS;
    for (let k = 0; k < N_BINS; k++) {
      const p = (i) => E.re[i] * E.re[i] + E.im[i] * E.im[i];
      const km = Math.max(0, k - 1), kp = Math.min(N_BINS - 1, k + 1);
      P[o + k] = 0.25 * p(o + km) + 0.5 * p(o + k) + 0.25 * p(o + kp); // light frequency smoothing
    }
  }
  const g = new Float32Array(N_BINS).fill(1);
  const g2min = gmin * gmin;
  for (let t = 0; t < T; t++) {
    const o = t * N_BINS;
    for (let k = 0; k < N_BINS; k++) {
      const late = t >= D ? a * P[o - D * N_BINS + k] : 0;
      const raw = Math.sqrt(Math.max(1 - (beta * late) / (P[o + k] + 1e-12), g2min));
      g[k] = 0.4 * raw + 0.6 * g[k]; // temporal smoothing against musical-noise flutter
      E.re[o + k] *= g[k]; E.im[o + k] *= g[k];
    }
  }
}

// --- Clarity EQ: de-boxing (-1.5 dB @ 250 Hz), presence (+2 dB @ 3 kHz), air (+3 dB @ 6.5 kHz). RBJ peaking filters.
const BANDS = [{ f: 250, gainDb: -1.5, q: 0.7 }, { f: 3000, gainDb: 2, q: 0.9 }, { f: 6500, gainDb: 3, q: 1.4 }];

function peaking(fs, { f, gainDb, q }) {
  const A = Math.pow(10, gainDb / 40), w0 = (2 * Math.PI * f) / fs, al = Math.sin(w0) / (2 * q), c = Math.cos(w0);
  const a0 = 1 + al / A;
  return { b: [(1 + al * A) / a0, (-2 * c) / a0, (1 - al * A) / a0], a: [(-2 * c) / a0, (1 - al / A) / a0] };
}

export function clarityMagnitudeDb(f, fs) {
  let total = 0;
  const w = (2 * Math.PI * f) / fs;
  for (const band of BANDS) {
    const { b, a } = peaking(fs, band);
    const nr = b[0] + b[1] * Math.cos(w) + b[2] * Math.cos(2 * w), ni = -(b[1] * Math.sin(w) + b[2] * Math.sin(2 * w));
    const dr = 1 + a[0] * Math.cos(w) + a[1] * Math.cos(2 * w), di = -(a[0] * Math.sin(w) + a[1] * Math.sin(2 * w));
    total += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return total;
}

/** In place. */
export function applyClarity(x, fs) {
  for (const band of BANDS) {
    const { b, a } = peaking(fs, band);
    let z1 = 0, z2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const o = b[0] * v + z1;
      z1 = b[1] * v - a[0] * o + z2;
      z2 = b[2] * v - a[1] * o;
      x[i] = o;
    }
  }
}

export const DEPTH_LEVELS = { standard: 1.0, strong: 1.4, maximum: 1.8 };
export const ECHO_LEVELS = { off: 0, low: 0.3, medium: 0.5, high: 0.8 }; // assumed RT60 in seconds
