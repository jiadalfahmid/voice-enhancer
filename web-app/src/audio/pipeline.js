// File-mode pipeline (PRD 7.1), pure and testable in Node. The Worker is a thin shell around this.
//   dry = the untouched input.  Model path: HPF -> resample to 16k -> chunked [STFT -> model -> ISTFT]
//   -> resample back -> + high band (>8 kHz) restored from the input, scaled by the model's 4-8 kHz gain.
// enhanceFile() returns {dry, wet, loud}; renderWindow()/renderOutput() re-mix without re-inference.
import { highPass } from './hpf.js';
import { resampleChunked } from './resample-async.js';
import { stft, istft, N_BINS, N_FFT } from './stft.js';
import { integratedLufs, normalizeToLufs, dbToLin } from './lufs.js';
import { analyzeLoudness, loudnessAt } from './loudness-cache.js';
import { limit } from './limiter.js';
import { mixDryWet } from './mixer.js';
import { applyDepth, suppressLateReverb, applyClarity } from './postprocess.js';

export const MODEL_RATE = 16000;
const HB_LO = 128; // bin 128 = 4 kHz at 16 kHz / FFT 512; bins 128..256 cover 4-8 kHz
export class CancelledError extends Error {
  constructor() { super('Processing cancelled'); this.name = 'CancelledError'; }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Enhance one 16 kHz segment per channel. The model sees the mono downmix; other channels get its complex mask. */
async function enhanceSegment(segs, model, polish = {}) {
  const hop = model.hop;
  const n = segs[0].length;
  const mono = new Float32Array(n);
  for (const s of segs) for (let i = 0; i < n; i++) mono[i] += s[i] / segs.length;
  const M = stft(mono, hop);
  const E = await model.process(M.re, M.im, M.frames, model.createState(), { tick });
  applyDepth(E, M, M.frames, polish.depth);
  suppressLateReverb(E, M.frames, { rt60: polish.rt60, hop });

  // per-frame 4-8 kHz gain, smoothed, expanded to per-sample (linear between frame centres)
  const gf = new Float32Array(M.frames);
  let sm = 1;
  for (let t = 0; t < M.frames; t++) {
    let num = 0, den = 0;
    for (let k = HB_LO; k < N_BINS; k++) {
      const i = t * N_BINS + k;
      num += E.re[i] * E.re[i] + E.im[i] * E.im[i];
      den += M.re[i] * M.re[i] + M.im[i] * M.im[i];
    }
    const g = den > 1e-10 ? Math.min(1, Math.sqrt(num / den)) : 1;
    sm = 0.8 * sm + 0.2 * g;
    gf[t] = sm;
  }
  const g = new Float32Array(n);
  const c0 = hop - N_FFT / 2; // sample position of frame f's centre is f*hop + c0
  for (let i = 0; i < n; i++) {
    const pos = (i - c0) / hop;
    const f0 = Math.min(M.frames - 1, Math.max(0, Math.floor(pos)));
    const f1 = Math.min(M.frames - 1, f0 + 1);
    const fr = Math.min(1, Math.max(0, pos - f0));
    g[i] = gf[f0] * (1 - fr) + gf[f1] * fr;
  }

  let chs;
  if (segs.length === 1) {
    chs = [istft(E.re, E.im, M.frames, n, hop)];
  } else {
    // complex mask m = E * conj(M) / (|M|^2 + eps), applied to each channel's own spectrum
    const mr = new Float32Array(M.re.length), mi = new Float32Array(M.re.length);
    for (let i = 0; i < mr.length; i++) {
      const d = M.re[i] * M.re[i] + M.im[i] * M.im[i] + 1e-9;
      mr[i] = (E.re[i] * M.re[i] + E.im[i] * M.im[i]) / d;
      mi[i] = (E.im[i] * M.re[i] - E.re[i] * M.im[i]) / d;
    }
    chs = segs.map((s) => {
      const S = stft(s, hop);
      const re = new Float32Array(S.re.length), im = new Float32Array(S.im.length);
      for (let i = 0; i < re.length; i++) {
        re[i] = S.re[i] * mr[i] - S.im[i] * mi[i];
        im[i] = S.re[i] * mi[i] + S.im[i] * mr[i];
      }
      return istft(re, im, S.frames, n, hop);
    });
  }
  return { chs, g };
}

/**
 * Chunked enhancement with overlap. Each chunk is processed over [start-ov, end+ov] with fresh model state;
 * neighbouring chunks are crossfaded (the warm-up part of each extended region is never used alone).
 */
async function enhanceChunked(x16, model, { chunkSeconds, overlapSeconds, crossfadeSeconds, polish }, onFrac, check) {
  const N = x16[0].length;
  const chunk = Math.round(chunkSeconds * MODEL_RATE);
  const ov = Math.round(overlapSeconds * MODEL_RATE);
  const xf = Math.round(crossfadeSeconds * MODEL_RATE);
  if (chunk < 2 * xf) throw new Error('chunkSeconds must be at least twice crossfadeSeconds');
  const out = x16.map(() => new Float32Array(N));
  const gOut = new Float32Array(N);
  const nChunks = Math.max(1, Math.ceil(N / chunk));
  for (let k = 0; k < nChunks; k++) {
    await tick();
    check();
    const b0 = k * chunk, b1 = Math.min(N, (k + 1) * chunk);
    const s = Math.max(0, b0 - ov), e = Math.min(N, b1 + ov);
    const res = await enhanceSegment(x16.map((x) => x.subarray(s, e)), model, polish);
    const half = xf >> 1;
    for (let p = Math.max(0, b0 - half); p < Math.min(N, b1 + half); p++) {
      let w = 1;
      if (k > 0 && p < b0 + half) w = (p - (b0 - half)) / xf;
      if (k < nChunks - 1 && p >= b1 - half) w = Math.min(w, 1 - (p - (b1 - half)) / xf);
      if (w <= 0) continue;
      for (let c = 0; c < out.length; c++) out[c][p] += w * res.chs[c][p - s];
      gOut[p] += w * res.g[p - s];
    }
    onFrac((k + 1) / nChunks);
  }
  return { out, g: gOut };
}

const downmix = (chs) => {
  const m = new Float32Array(chs[0].length);
  for (const x of chs) for (let i = 0; i < m.length; i++) m[i] += x[i] / chs.length;
  return m;
};

const fit = (y, len) => {
  if (y.length === len) return y;
  const o = new Float32Array(len);
  o.set(y.subarray(0, Math.min(len, y.length)));
  return o;
};

/**
 * @param {{channels: Float32Array[], sampleRate: number, model: object, hpf?: {enabled?: boolean, fc?: number},
 *   chunkSeconds?: number, overlapSeconds?: number, crossfadeSeconds?: number,
 *   onProgress?: (f: number) => void, onStatus?: (t: string) => void, isCancelled?: () => boolean}} o
 * @returns {Promise<{dry: Float32Array[], wet: Float32Array[], sampleRate: number, loud: object}>}
 */
export async function enhanceFile({
  channels, sampleRate, model, hpf = { enabled: true, fc: 80 },
  // PRD says 5-min windows; 30 s keeps memory and cancel latency low. Configurable.
  chunkSeconds = 30, overlapSeconds = 2, crossfadeSeconds = 1,
  depth = 1, rt60 = 0, clarity = false, // optional voice polish (see postprocess.js)
  mono = false, // centre the voice: enhance the mono downmix and output it on every channel
  onProgress = () => {}, onStatus = () => {}, isCancelled = () => false,
}) {
  const check = () => { if (isCancelled()) throw new CancelledError(); };
  const len = channels[0].length;
  const dry = channels; // untouched input: strength 0 must reproduce it exactly
  const proc = mono && channels.length > 1 ? [downmix(channels)] : channels; // what the model path sees
  const nCh = proc.length;
  onProgress(0.01);

  // model input path: HPF (never applied to `dry`), then down to 16 kHz
  let hpfDry = proc.map((x) => highPass(x, sampleRate, hpf));
  const x16 = [];
  for (let c = 0; c < nCh; c++) { x16.push(await resampleChunked(hpfDry[c], sampleRate, MODEL_RATE, { check })); onProgress(0.01 + 0.04 * ((c + 1) / nCh)); }

  // high band the 16 kHz model cannot see: hpfDry minus its own 8 kHz low-pass
  let hb = null;
  if (sampleRate > MODEL_RATE) {
    hb = [];
    for (let c = 0; c < nCh; c++) {
      const low = fit(await resampleChunked(x16[c], MODEL_RATE, sampleRate, { check }), len);
      const h = new Float32Array(len);
      for (let i = 0; i < len; i++) h[i] = hpfDry[c][i] - low[i];
      hb.push(h);
      onProgress(0.05 + 0.04 * ((c + 1) / nCh));
    }
  }
  hpfDry = null;
  check();

  const enhanced = await enhanceChunked(x16, model, { chunkSeconds, overlapSeconds, crossfadeSeconds, polish: { depth, rt60 } },
    (f) => onProgress(0.09 + 0.76 * f), check);

  let wet = [];
  for (let c = 0; c < nCh; c++) {
    wet.push(fit(await resampleChunked(enhanced.out[c], MODEL_RATE, sampleRate, { check }), len));
    onProgress(0.85 + 0.07 * ((c + 1) / nCh));
  }
  if (hb) {
    const g16 = enhanced.g, last = g16.length - 1, ratio = MODEL_RATE / sampleRate;
    for (let c = 0; c < nCh; c++) {
      const w = wet[c], h = hb[c];
      for (let i = 0; i < len; i++) {
        const pos = i * ratio, i0 = Math.min(last, Math.floor(pos)), i1 = Math.min(last, i0 + 1), fr = pos - i0;
        w[i] += (g16[i0] * (1 - fr) + g16[i1] * fr) * h[i];
      }
    }
  }
  hb = null;
  if (clarity) for (const w of wet) applyClarity(w, sampleRate);
  if (proc !== channels) wet = channels.map(() => wet[0]); // dual-mono output (same array, read-only)

  onStatus('Analyzing loudness...');
  const loud = await analyzeLoudness(dry, wet, sampleRate, { check });
  onProgress(1);
  return { dry, wet, sampleRate, loud };
}

const applyGain = (chs, gainDb) => {
  const g = dbToLin(gainDb);
  return chs.map((x) => { const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g; return y; });
};

function normalizedGainDb(cache, strength, targetLufs) {
  const l = cache.loud ? loudnessAt(cache.loud, strength) : null;
  return l !== null && Number.isFinite(l) ? targetLufs - l : null; // null -> caller measures
}

/** Full-length re-mix for export: strength -> loudness gain (from cached stats) -> limiter (PRD 7.5). Measures final LUFS. */
export function renderOutput(cache, {
  strength = 1, targetLufs = -16, ceilingDb = -1, normalize = true, useLimiter = true,
} = {}) {
  const { dry, wet, sampleRate } = cache;
  let ch = mixDryWet(dry, wet, strength, 0);
  let gainDb = 0;
  if (normalize) {
    const cached = normalizedGainDb(cache, strength, targetLufs);
    if (cached !== null) { gainDb = cached; ch = applyGain(ch, gainDb); }
    else ({ channels: ch, gainDb } = normalizeToLufs(ch, sampleRate, targetLufs));
  }
  let maxGainReductionDb = 0;
  if (useLimiter) ({ channels: ch, maxGainReductionDb } = limit(ch, sampleRate, { ceilingDb }));
  return { channels: ch, gainDb, maxGainReductionDb, lufs: integratedLufs(ch, sampleRate) };
}

/** Short preview for the live slider: only `lengthSec` of audio is mixed and limited; gain comes from the whole file. */
export function renderWindow(cache, {
  strength = 1, targetLufs = -16, ceilingDb = -1, normalize = true, useLimiter = true,
} = {}, { startSec = 0, lengthSec = 20 } = {}) {
  const { dry, wet, sampleRate } = cache;
  const len = dry[0].length;
  const a = Math.min(len, Math.max(0, Math.floor(startSec * sampleRate)));
  const b = Math.min(len, a + Math.max(1, Math.round(lengthSec * sampleRate)));
  let ch = mixDryWet(dry.map((x) => x.subarray(a, b)), wet.map((x) => x.subarray(a, b)), strength, 0);
  let gainDb = 0;
  let lufs = cache.loud ? loudnessAt(cache.loud, strength) : integratedLufs(ch, sampleRate);
  if (normalize) {
    const cached = normalizedGainDb(cache, strength, targetLufs);
    if (cached !== null) { gainDb = cached; ch = applyGain(ch, gainDb); lufs = targetLufs; }
    else ({ channels: ch, gainDb } = normalizeToLufs(ch, sampleRate, targetLufs));
  }
  let maxGainReductionDb = 0;
  if (useLimiter && b > a) ({ channels: ch, maxGainReductionDb } = limit(ch, sampleRate, { ceilingDb }));
  return { channels: ch, gainDb, maxGainReductionDb, lufs, startSec: a / sampleRate, lengthSec: (b - a) / sampleRate };
}
