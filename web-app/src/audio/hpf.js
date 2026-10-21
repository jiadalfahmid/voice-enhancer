// 2nd-order Butterworth high-pass (12 dB/oct, -3.01 dB at fc). Bypass returns the input untouched.

export function hpfCoeffs(fs, fc = 80) {
  const Q = Math.SQRT1_2;
  const K = Math.tan((Math.PI * fc) / fs);
  const norm = 1 / (1 + K / Q + K * K);
  return {
    b0: norm, b1: -2 * norm, b2: norm,
    a1: 2 * (K * K - 1) * norm,
    a2: (1 - K / Q + K * K) * norm,
  };
}

/** Magnitude response in dB at frequency f. */
export function hpfMagnitudeDb(f, fs, fc = 80) {
  const { b0, b1, b2, a1, a2 } = hpfCoeffs(fs, fc);
  const w = (2 * Math.PI * f) / fs;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
  const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** @param {Float32Array} x @returns {Float32Array} new array, or x itself when disabled */
export function highPass(x, fs, { enabled = true, fc = 80 } = {}) {
  if (!enabled) return x;
  const { b0, b1, b2, a1, a2 } = hpfCoeffs(fs, fc);
  const y = new Float32Array(x.length);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const o = b0 * v + z1;
    z1 = b1 * v - a1 * o + z2;
    z2 = b2 * v - a2 * o;
    y[i] = o;
  }
  return y;
}
