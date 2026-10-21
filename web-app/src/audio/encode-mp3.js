// MP3 export through lamejs (@breezystack/lamejs, LGPL-3.0). The encoder class is injected so this file
// is testable without the package. MP3 adds ~1100 samples of encoder delay, so duration is not sample-exact
// (the "within 1 sample" rule in F8 applies to WAV).
import { resample } from './resample.js';

const VALID_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
export const MP3_BITRATES = [128, 192, 256];
const tick = () => new Promise((r) => setTimeout(r, 0));

const toInt16 = (x, a, b) => {
  const o = new Int16Array(b - a);
  for (let i = a; i < b; i++) { const v = x[i] > 1 ? 1 : x[i] < -1 ? -1 : x[i]; o[i - a] = Math.round(v < 0 ? v * 32768 : v * 32767); }
  return o;
};

/** @returns {Promise<Uint8Array[]>} parts */
export async function encodeMp3(channels, sampleRate, kbps, { Mp3Encoder, onProgress = () => {}, check = () => {} }) {
  if (!Mp3Encoder) throw Object.assign(new Error('MP3 encoder unavailable'), { code: 'MP3_UNAVAILABLE' });
  if (!MP3_BITRATES.includes(kbps)) throw new Error('kbps must be 128, 192 or 256');
  let chs = channels.slice(0, 2), fs = sampleRate;
  if (!VALID_RATES.includes(fs)) { chs = chs.map((c) => resample(c, fs, 48000)); fs = 48000; }
  const enc = new Mp3Encoder(chs.length, fs, kbps);
  const len = chs[0].length, block = 1152 * 40;
  const parts = [];
  const push = (buf) => { if (buf && buf.length) parts.push(new Uint8Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf)); };
  for (let a = 0, k = 0; a < len; a += block, k++) {
    const b = Math.min(len, a + block);
    push(chs.length === 1 ? enc.encodeBuffer(toInt16(chs[0], a, b)) : enc.encodeBuffer(toInt16(chs[0], a, b), toInt16(chs[1], a, b)));
    if ((k & 7) === 7) { onProgress(b / len); await tick(); check(); }
  }
  push(enc.flush());
  onProgress(1);
  return parts;
}
