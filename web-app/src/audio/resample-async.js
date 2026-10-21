// Resample in ~10 s blocks (with a halo so the result equals one big resample()) and yield between
// blocks, so a worker can notice a cancel message during the long resampling phases.
import { resample } from './resample.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

export async function resampleChunked(x, from, to, { blockSeconds = 10, check = () => {} } = {}) {
  if (from === to) return x.slice();
  const g = gcd(from, to);
  const up = to / g, down = from / g;
  const outLen = Math.ceil((x.length * up) / down);
  if (x.length <= 2 * blockSeconds * from) return resample(x, from, to);
  const block = down * Math.ceil((blockSeconds * from) / down); // input block length, multiple of `down`
  const halo = down * Math.ceil(512 / down);                   // >> filter half-width in input samples
  const out = new Float32Array(outLen);
  for (let a = 0; a < x.length; a += block) {
    check();
    const left = Math.max(0, a - halo);
    const right = Math.min(x.length, a + block + halo);
    const y = resample(x.subarray(left, right), from, to);
    const j0 = ((a - left) / down) * up;
    const o0 = (a / down) * up;
    const n = Math.min(outLen - o0, (block / down) * up);
    out.set(y.subarray(j0, j0 + n), o0);
    await tick();
  }
  return out;
}
