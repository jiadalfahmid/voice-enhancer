// Polyphase windowed-sinc (Kaiser) rational resampler. Zero-phase (symmetric kernel centred on the
// output position) so it adds no group delay; output length is ceil(len * to / from).

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

function besselI0(x) {
  let sum = 1, term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 60; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < 1e-14 * sum) break;
  }
  return sum;
}

function kaiser(t, beta) { // t in [-1, 1]
  if (t <= -1 || t >= 1) return 0;
  return besselI0(beta * Math.sqrt(1 - t * t)) / besselI0(beta);
}

function sinc(t) {
  if (t === 0) return 1;
  const a = Math.PI * t;
  return Math.sin(a) / a;
}

const tableCache = new Map();

function buildTable(up, down, halfWidth, beta) {
  const key = `${up}/${down}/${halfWidth}/${beta}`;
  if (tableCache.has(key)) return tableCache.get(key);
  const scale = Math.min(1, up / down);
  const cutoff = scale * 0.97; // keep the transition band under the new Nyquist
  const H = Math.ceil(halfWidth / scale);
  const taps = 2 * H;
  const table = new Float64Array(up * taps);
  for (let r = 0; r < up; r++) {
    const frac = r / up;
    let sum = 0;
    for (let m = -H + 1; m <= H; m++) {
      const d = m - frac;
      const v = cutoff * sinc(cutoff * d) * kaiser(d / H, beta);
      table[r * taps + (m + H - 1)] = v;
      sum += v;
    }
    for (let j = 0; j < taps; j++) table[r * taps + j] /= sum; // unity DC gain per phase
  }
  const t = { table, H, taps };
  tableCache.set(key, t);
  return t;
}

/** @param {Float32Array} x */
export function resample(x, fromRate, toRate, { halfWidth = 24, beta = 8.6 } = {}) {
  if (fromRate === toRate) return x.slice();
  const g = gcd(fromRate, toRate);
  const up = toRate / g;
  const down = fromRate / g;
  const { table, H, taps } = buildTable(up, down, halfWidth, beta);
  const len = x.length;
  const outLen = Math.ceil((len * up) / down);
  const y = new Float32Array(outLen);
  for (let n = 0; n < outLen; n++) {
    const num = n * down;
    const base = Math.floor(num / up);
    const r = num - base * up;
    const t0 = r * taps;
    const first = base - H + 1;
    let acc = 0;
    if (first >= 0 && first + taps <= len) {
      for (let j = 0; j < taps; j++) acc += x[first + j] * table[t0 + j];
    } else {
      for (let j = 0; j < taps; j++) {
        const i = first + j;
        if (i >= 0 && i < len) acc += x[i] * table[t0 + j];
      }
    }
    y[n] = acc;
  }
  return y;
}
