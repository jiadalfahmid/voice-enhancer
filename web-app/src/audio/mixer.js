// Dry/wet mixer. `dryDelay` (samples) delays the dry path to match model latency (live mode);
// in file mode the wet path is already aligned so dryDelay is 0.

/** @param {Float32Array[]} dry @param {Float32Array[]} wet */
export function mixDryWet(dry, wet, strength, dryDelay = 0) {
  const s = Math.min(1, Math.max(0, strength));
  return dry.map((d, c) => {
    const w = wet[c];
    const n = Math.min(d.length, w.length);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const di = i - dryDelay;
      const dv = di >= 0 ? d[di] : 0;
      y[i] = (1 - s) * dv + s * w[i];
    }
    return y;
  });
}
