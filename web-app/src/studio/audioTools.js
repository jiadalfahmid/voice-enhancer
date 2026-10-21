// Pure helpers for the studio UI (unit-tested in Node).
import { integratedLufs, dbToLin } from '../audio/lufs.js';

export const PREVIEW_SECONDS = 20;
export const STUDIO_TARGET_LUFS = -16; // loudness of every stored result
export const COMPARE_LUFS = -20;       // both sides of an A/B are matched to this

export function windowOf(channels, rate, startSec, lengthSec = PREVIEW_SECONDS) {
  const len = channels[0].length;
  const a = Math.min(len, Math.max(0, Math.floor(startSec * rate)));
  const b = Math.min(len, a + Math.max(1, Math.round(lengthSec * rate)));
  return channels.map((c) => c.subarray(a, b));
}

/** Copy of `channels` scaled so its integrated loudness is `target` LUFS (max +-24 dB; silence is left alone). */
export function matchLoudness(channels, rate, target = COMPARE_LUFS) {
  const l = integratedLufs(channels, rate);
  const g = Number.isFinite(l) && l > -70 ? dbToLin(Math.max(-24, Math.min(24, target - l))) : 1;
  return channels.map((c) => { const y = new Float32Array(c.length); for (let i = 0; i < y.length; i++) y[i] = c[i] * g; return y; });
}

/** Trim or zero-pad each channel to exactly `len` samples (keeps timing aligned to the original). */
export function fitLength(channels, len) {
  return channels.map((c) => { if (c.length === len) return c; const y = new Float32Array(len); y.set(c.subarray(0, Math.min(len, c.length))); return y; });
}

/** Imported results may be mono/stereo differently from the original: match the channel count. */
export function matchChannels(channels, n) {
  if (channels.length === n) return channels;
  if (n === 1) { const m = new Float32Array(channels[0].length); for (const c of channels) for (let i = 0; i < m.length; i++) m[i] += c[i] / channels.length; return [m]; }
  return Array.from({ length: n }, (_, i) => channels[Math.min(i, channels.length - 1)]);
}

export const durationLimitMinutes = (deviceMemoryGb = 4) => (deviceMemoryGb >= 8 ? 30 : 10);
export const storeBudgetBytes = (deviceMemoryGb = 4) => Math.min(1.5 * 1024 ** 3, deviceMemoryGb * 0.2 * 1024 ** 3);
export const safeName = (s) => String(s).replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'audio';
export const fmtDuration = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
