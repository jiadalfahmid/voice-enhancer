// Helpers for the A/B player (pure, unit-tested).
export const CROSSFADE_SECONDS = 0.01; // F7: toggle crossfade, no click

/** Min/max per bucket over the channel average, for drawing a waveform. */
export function computePeaks(channels, buckets) {
  const len = channels[0].length, n = channels.length;
  const min = new Float32Array(buckets), max = new Float32Array(buckets);
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor((b * len) / buckets), e = Math.max(a + 1, Math.floor(((b + 1) * len) / buckets));
    let lo = Infinity, hi = -Infinity;
    for (let i = a; i < e && i < len; i++) {
      let v = 0;
      for (let c = 0; c < n; c++) v += channels[c][i];
      v /= n;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo === Infinity ? 0 : lo; max[b] = hi === -Infinity ? 0 : hi;
  }
  return { min, max };
}

/** Gains for the two playback paths: which = 'a' (original) or 'b' (enhanced). */
export const gainsFor = (which) => ({ a: which === 'a' ? 1 : 0, b: which === 'b' ? 1 : 0 });

/** Playhead position (seconds) inside a looping window. */
export const loopPosition = (elapsed, duration) => (duration > 0 ? ((elapsed % duration) + duration) % duration : 0);
