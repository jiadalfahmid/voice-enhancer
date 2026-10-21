// Model contract (spectral, async):
//   { id, label, hop, createState(), process(re, im, T, state, {tick}) -> Promise<{re, im}> }
// `re/im` are T*257 STFT bins (FFT 512, `hop` samples, sqrt-Hann, 16 kHz). The model returns the enhanced
// complex spectrum for the same frames. Mask-style models just multiply and return.
import { N_BINS } from './stft.js';

export class UnknownModelError extends Error {
  constructor(id) { super(`Unknown enhancement model: ${id}`); this.code = 'UNKNOWN_MODEL'; }
}

export const passthroughModel = {
  id: 'passthrough',
  label: 'Passthrough (testing only)',
  hop: 160,
  createState: () => null,
  async process(re, im) {
    return { re: Float32Array.from(re), im: Float32Array.from(im) };
  },
};

/**
 * Crude stationary-noise gate. DEMO ONLY: file-mode only (it looks at the whole segment: per-bin
 * 10th-percentile magnitude as the noise floor), so it is not a streaming model.
 */
export const spectralGateModel = {
  id: 'spectral-gate-demo',
  label: 'Demo noise gate (rough, not a trained model)',
  hop: 160,
  createState: () => ({}),
  async process(re, im, T) {
    const mag = new Float32Array(T * N_BINS);
    for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i]);
    const noise = new Float32Array(N_BINS);
    const col = new Float32Array(T);
    for (let k = 0; k < N_BINS; k++) {
      for (let t = 0; t < T; t++) col[t] = mag[t * N_BINS + k];
      col.sort();
      noise[k] = 2.2 * col[Math.floor(0.1 * (T - 1))]; // P10 of a Rayleigh-like magnitude is ~0.45x its mean
    }
    const outRe = new Float32Array(re.length), outIm = new Float32Array(im.length);
    const prev = new Float32Array(N_BINS).fill(1);
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < N_BINS; k++) {
        const i = t * N_BINS + k;
        const raw = mag[i] > 1e-9 ? 1 - (1.2 * noise[k]) / mag[i] : 0;
        prev[k] = 0.5 * prev[k] + 0.5 * Math.min(1, Math.max(0.05, raw));
        outRe[i] = re[i] * prev[k];
        outIm[i] = im[i] * prev[k];
      }
    }
    return { re: outRe, im: outIm };
  },
};

/** Models that need no download. Real models are loaded by the worker (see workers/load-model.js). */
export async function builtinLoader(id) {
  if (id === passthroughModel.id) return passthroughModel;
  if (id === spectralGateModel.id) return spectralGateModel;
  throw new UnknownModelError(id);
}
