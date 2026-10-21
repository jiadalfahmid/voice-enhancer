// Look-ahead true-peak limiter (PRD section 6): look-ahead 5 ms, attack 1 ms, release 80 ms,
// ceiling -1 dBTP, 4x-oversampled detection. Offline (whole buffer); output is time-aligned
// with the input (look-ahead delay compensated).
//
// Guarantee: required gain g_req[p] = ceiling / truePeak[p]. Sliding min over the look-ahead
// window, then a moving average of attack length, then a release smoother that only ever
// lowers the gain, keeps gain[p] <= g_req[p] at every sample.

import { dbToLin } from './lufs.js';

const TP_HALF = 24; // 12 under-detected inter-sample peaks on hard-edged Nyquist bursts by ~0.4 dB
const tpTaps = [0.25, 0.5, 0.75].map((frac) => {
  const t = new Float64Array(2 * TP_HALF);
  for (let m = -TP_HALF + 1; m <= TP_HALF; m++) {
    const d = m - frac;
    const s = Math.sin(Math.PI * d) / (Math.PI * d);
    const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / TP_HALF);
    t[m + TP_HALF - 1] = s * w;
  }
  return t;
});

/** Max over the 4x-oversampled points that follow sample n (n, n+.25, n+.5, n+.75). */
function truePeakInto(channels, peaks) {
  const len = peaks.length;
  for (const x of channels) {
    for (let n = 0; n < len; n++) {
      let p = Math.abs(x[n]);
      const first = n - TP_HALF + 1;
      const interior = first >= 0 && first + 2 * TP_HALF <= len;
      for (let q = 0; q < 3; q++) {
        const t = tpTaps[q];
        let acc = 0;
        if (interior) {
          for (let j = 0; j < 2 * TP_HALF; j++) acc += x[first + j] * t[j];
        } else {
          for (let j = 0; j < 2 * TP_HALF; j++) {
            const i = first + j;
            if (i >= 0 && i < len) acc += x[i] * t[j];
          }
        }
        const a = Math.abs(acc);
        if (a > p) p = a;
      }
      if (p > peaks[n]) peaks[n] = p;
    }
  }
}

/**
 * @param {Float32Array[]} channels
 * @returns {{channels: Float32Array[], maxGainReductionDb: number}}
 */
export function limit(channels, fs, { ceilingDb = -1, lookaheadMs = 5, attackMs = 1, releaseMs = 80 } = {}) {
  const len = channels[0].length;
  const ceil = dbToLin(ceilingDb);
  const L = Math.max(1, Math.round((lookahead(lookaheadMs) * fs) / 1000));
  const A = Math.max(1, Math.min(L + 1, Math.round((attackMs * fs) / 1000)));
  const rel = Math.exp(-1 / ((releaseMs / 1000) * fs));
  const total = len + L;

  const req = new Float32Array(total).fill(1);
  const peaks = new Float32Array(len);
  truePeakInto(channels, peaks);
  for (let p = 0; p < len; p++) if (peaks[p] > ceil) req[p] = ceil / peaks[p];

  // sliding min over p in [n-L, n] (monotonic deque)
  const env = new Float32Array(total);
  const dq = new Int32Array(total);
  let head = 0, tail = 0;
  for (let n = 0; n < total; n++) {
    const v = req[n];
    while (tail > head && req[dq[tail - 1]] >= v) tail--;
    dq[tail++] = n;
    while (dq[head] < n - L) head++;
    env[n] = req[dq[head]];
  }

  // moving average over attack window (out-of-range counts as 1.0), then release smoother
  let sum = A; // window [n-A+1, n] starts with A virtual 1.0 entries before the signal
  let prev = 1;
  let minGain = 1;
  for (let n = 0; n < total; n++) {
    sum += env[n];
    const drop = n - A;
    sum -= drop >= 0 ? env[drop] : 1;
    const avg = sum / A;
    const s = avg < prev ? avg : prev * rel + avg * (1 - rel);
    req[n] = s; // reuse buffer: gain curve
    prev = s;
    if (s < minGain) minGain = s;
  }

  const out = channels.map((x) => {
    const y = new Float32Array(len);
    for (let p = 0; p < len; p++) y[p] = x[p] * req[p + L];
    return y;
  });
  return { channels: out, maxGainReductionDb: -20 * Math.log10(minGain) };
}

function lookahead(ms) { return ms; }
