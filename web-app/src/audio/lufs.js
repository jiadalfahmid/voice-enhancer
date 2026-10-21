// ITU-R BS.1770-4 loudness: K-weighting, 400 ms blocks (75% overlap), gating -70 LUFS abs / -10 LU rel.

export const dbToLin = (db) => Math.pow(10, db / 20);
export const linToDb = (lin) => 20 * Math.log10(lin);

export function kWeightCoeffs(fs) {
  // Stage 1: high shelf
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  // Stage 2: RLB high-pass
  const f1 = 38.13547087602444, Q2 = 0.5003270373238773;
  K = Math.tan((Math.PI * f1) / fs);
  a0 = 1 + K / Q2 + K * K;
  const rlb = {
    b: [1, -2, 1],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0],
  };
  return [shelf, rlb];
}

/** Mean-square energy of K-weighted signal per 100 ms step, per channel summed. */
function stepEnergies(channels, fs) {
  const step = Math.round(0.1 * fs);
  const len = channels[0].length;
  const nSteps = Math.floor(len / step);
  const e = new Float64Array(nSteps);
  const stages = kWeightCoeffs(fs);
  for (const x of channels) {
    const st = [[0, 0], [0, 0]];
    for (let s = 0; s < nSteps; s++) {
      let acc = 0;
      const end = (s + 1) * step;
      for (let i = s * step; i < end; i++) {
        let v = x[i];
        for (let k = 0; k < 2; k++) {
          const { b, a } = stages[k];
          const z = st[k];
          const o = b[0] * v + z[0];
          z[0] = b[1] * v - a[0] * o + z[1];
          z[1] = b[2] * v - a[1] * o;
          v = o;
        }
        acc += v * v;
      }
      e[s] += acc / step;
    }
  }
  return e;
}

const toLufs = (z) => -0.691 + 10 * Math.log10(z);

/** Per-400ms-block mean-square values from 100 ms step energies. */
export function blockPowersFromSteps(e) {
  const n = e.length - 3;
  if (n <= 0) return new Float64Array(0);
  const z = new Float64Array(n);
  for (let j = 0; j < n; j++) z[j] = (e[j] + e[j + 1] + e[j + 2] + e[j + 3]) / 4;
  return z;
}

/** Per-400ms-block summed mean-square values (hop 100 ms). */
export function blockPowers(channels, fs) {
  return blockPowersFromSteps(stepEnergies(channels, fs));
}

/** Gated integrated loudness from block powers. -Infinity if nothing passes. */
export function lufsFromBlocks(z) {
  const absThr = Math.pow(10, (-70 + 0.691) / 10);
  let sum = 0, cnt = 0;
  for (const v of z) if (v > absThr) { sum += v; cnt++; }
  if (!cnt) return -Infinity;
  const relThr = (sum / cnt) * Math.pow(10, -1);
  let s2 = 0, c2 = 0;
  for (const v of z) if (v > absThr && v > relThr) { s2 += v; c2++; }
  return c2 ? toLufs(s2 / c2) : -Infinity;
}

export const lufsFromSteps = (e) => lufsFromBlocks(blockPowersFromSteps(e));

/** Integrated loudness (LUFS) with absolute + relative gating. -Infinity if nothing passes. */
export function integratedLufs(channels, fs) {
  return lufsFromBlocks(blockPowers(channels, fs));
}

/** Short-term (3 s window, 100 ms hop) loudness series in LUFS. */
export function shortTermSeries(channels, fs) {
  const e = stepEnergies(channels, fs);
  const w = 30;
  const n = e.length - w + 1;
  const out = [];
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let k = 0; k < w; k++) s += e[j + k];
    out.push(toLufs(s / w));
  }
  return out;
}

/** Apply gain so integrated loudness hits targetLufs. Returns new channels. */
export function normalizeToLufs(channels, fs, targetLufs) {
  const measured = integratedLufs(channels, fs);
  const gainDb = Number.isFinite(measured) ? targetLufs - measured : 0;
  const g = dbToLin(gainDb);
  const out = channels.map((x) => {
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
    return y;
  });
  return { channels: out, measured, gainDb };
}
