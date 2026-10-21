// Instant loudness for the strength slider. K-weighting is linear, so for mix = (1-s)*dry + s*wet the
// per-100 ms energy is (1-s)^2*Edd + s^2*Eww + 2s(1-s)*Edw. We measure Edd/Eww/Edw once per file and
// can then compute the exact gated loudness of ANY strength in microseconds (no re-filtering).
import { kWeightCoeffs, lufsFromSteps } from './lufs.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function analyzeLoudness(dry, wet, fs, { check = () => {} } = {}) {
  const step = Math.round(0.1 * fs);
  const len = Math.min(dry[0].length, wet[0].length);
  const nSteps = Math.floor(len / step);
  const edd = new Float64Array(nSteps), eww = new Float64Array(nSteps), edw = new Float64Array(nSteps);
  const [sh, rl] = kWeightCoeffs(fs);
  const [sb0, sb1, sb2] = sh.b, [sa1, sa2] = sh.a;
  const [rb0, rb1, rb2] = rl.b, [ra1, ra2] = rl.a;
  for (let c = 0; c < dry.length; c++) {
    const d = dry[c], w = wet[c];
    let ds1 = 0, ds2 = 0, dr1 = 0, dr2 = 0, ws1 = 0, ws2 = 0, wr1 = 0, wr2 = 0;
    for (let s = 0; s < nSteps; s++) {
      let aD = 0, aW = 0, aX = 0;
      const end = (s + 1) * step;
      for (let i = s * step; i < end; i++) {
        let v = d[i];
        let o = sb0 * v + ds1; ds1 = sb1 * v - sa1 * o + ds2; ds2 = sb2 * v - sa2 * o;
        v = o; o = rb0 * v + dr1; dr1 = rb1 * v - ra1 * o + dr2; dr2 = rb2 * v - ra2 * o;
        const kd = o;
        v = w[i];
        o = sb0 * v + ws1; ws1 = sb1 * v - sa1 * o + ws2; ws2 = sb2 * v - sa2 * o;
        v = o; o = rb0 * v + wr1; wr1 = rb1 * v - ra1 * o + wr2; wr2 = rb2 * v - ra2 * o;
        aD += kd * kd; aW += o * o; aX += kd * o;
      }
      edd[s] += aD / step; eww[s] += aW / step; edw[s] += aX / step;
      if ((s & 127) === 127) { await tick(); check(); }
    }
  }
  return { edd, eww, edw, nSteps };
}

/** Exact integrated LUFS of the dry/wet mix at `strength` (0..1). */
export function loudnessAt(stats, strength) {
  const s = Math.min(1, Math.max(0, strength));
  const a = (1 - s) * (1 - s), b = s * s, x = 2 * s * (1 - s);
  const e = new Float64Array(stats.nSteps);
  for (let j = 0; j < e.length; j++) e[j] = Math.max(0, a * stats.edd[j] + b * stats.eww[j] + x * stats.edw[j]);
  return lufsFromSteps(e);
}
