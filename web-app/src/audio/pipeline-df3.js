// Dedicated file-mode enhancement pipeline for DeepFilterNet3 (48 kHz).
// Features native 48 kHz full-band processing, 480-sample time-domain framing,
// shared resampling, cancellation checks, and loudness cache integration.

import { highPass } from './hpf.js';
import { resampleChunked } from './resample-async.js';
import { analyzeLoudness } from './loudness-cache.js';
import { applyClarity } from './postprocess.js';
import { CancelledError } from './pipeline.js';

export const DF3_MODEL_RATE = 48000;
export const DF3_FRAME_LENGTH = 480;

const tick = () => new Promise((r) => setTimeout(r, 0));

const fitLength = (arr, len) => {
  if (arr.length === len) return arr;
  if (arr.length > len) return arr.slice(0, len);
  const out = new Float32Array(len);
  out.set(arr);
  return out;
};

const downmix = (chs) => {
  const m = new Float32Array(chs[0].length);
  for (const x of chs) {
    for (let i = 0; i < m.length; i++) m[i] += x[i] / chs.length;
  }
  return m;
};

/**
 * Enhance a single 48 kHz audio channel using DeepFilterNet3 sequential frame processing.
 * @param {Float32Array} x48 - 48 kHz mono PCM samples
 * @param {object} model - DeepFilterNet3 model adapter
 * @param {object} callbacks - { check, onProgress }
 * @returns {Promise<Float32Array>} Enhanced 48 kHz samples of exact same length
 */
async function enhanceChannel48k(x48, model, { check = () => {}, onProgress = () => {} } = {}) {
  check();
  const len = x48.length;
  const numFrames = Math.max(1, Math.ceil(len / DF3_FRAME_LENGTH));
  const padLen = numFrames * DF3_FRAME_LENGTH;

  let padded = x48;
  if (len < padLen) {
    padded = new Float32Array(padLen);
    padded.set(x48);
  }

  const state = model.createState(100);
  const outPadded = new Float32Array(padLen);

  const BLOCK_FRAMES = 50; // 50 frames = 500 ms of 48 kHz audio per UI tick
  try {
    for (let startFrame = 0; startFrame < numFrames; startFrame += BLOCK_FRAMES) {
      await tick();
      check();
      const count = Math.min(BLOCK_FRAMES, numFrames - startFrame);
      for (let f = 0; f < count; f++) {
        const frameIdx = startFrame + f;
        const inFrame = padded.subarray(frameIdx * DF3_FRAME_LENGTH, (frameIdx + 1) * DF3_FRAME_LENGTH);
        const outFrame = state.processFrame(inFrame);
        outPadded.set(outFrame, frameIdx * DF3_FRAME_LENGTH);
      }
      onProgress((startFrame + count) / numFrames);
    }
  } finally {
    state.free();
  }

  return fitLength(outPadded, len);
}

/**
 * Enhance an entire audio file with DeepFilterNet3 (48 kHz).
 * Returns `{ dry, wet, sampleRate, loud }` cache compatible with studio player and exports.
 */
export async function enhanceFileDf3({
  channels,
  sampleRate,
  model,
  hpf = { enabled: true, fc: 80 },
  clarity = false,
  mono = false,
  onProgress = () => {},
  onStatus = () => {},
  isCancelled = () => false,
}) {
  const check = () => { if (isCancelled()) throw new CancelledError(); };
  const len = channels[0].length;
  const dry = channels;
  const proc = mono && channels.length > 1 ? [downmix(channels)] : channels;
  const nCh = proc.length;

  onProgress(0.01);
  onStatus('Preprocessing audio...');

  // 1. High-pass filter (on model input only)
  const hpfDry = proc.map((x) => highPass(x, sampleRate, hpf));
  check();

  // 2. Resample to 48 kHz if necessary
  const x48 = [];
  for (let c = 0; c < nCh; c++) {
    if (sampleRate === DF3_MODEL_RATE) {
      x48.push(hpfDry[c]);
    } else {
      const resampled = await resampleChunked(hpfDry[c], sampleRate, DF3_MODEL_RATE, { check });
      x48.push(resampled);
    }
    onProgress(0.01 + 0.08 * ((c + 1) / nCh));
  }
  check();

  // 3. Process with DeepFilterNet3
  onStatus('Enhancing with DeepFilterNet3...');
  const enh48 = [];
  for (let c = 0; c < nCh; c++) {
    const chOut = await enhanceChannel48k(x48[c], model, {
      check,
      onProgress: (frac) => onProgress(0.09 + 0.70 * ((c + frac) / nCh)),
    });
    enh48.push(chOut);
  }
  check();

  // 4. Resample back to original sample rate if necessary
  onStatus('Resampling output...');
  let wet = [];
  for (let c = 0; c < nCh; c++) {
    if (sampleRate === DF3_MODEL_RATE) {
      wet.push(fitLength(enh48[c], len));
    } else {
      const up = await resampleChunked(enh48[c], DF3_MODEL_RATE, sampleRate, { check });
      wet.push(fitLength(up, len));
    }
    onProgress(0.80 + 0.12 * ((c + 1) / nCh));
  }
  check();

  // 5. Optional post-processing clarity
  if (clarity) {
    for (const w of wet) applyClarity(w, sampleRate);
  }

  // 6. Multi-channel mapping if mono option was selected
  if (proc !== channels) {
    wet = channels.map(() => wet[0]);
  }

  // 7. Loudness analysis for studio rendering and sliders
  onStatus('Analyzing loudness...');
  const loud = await analyzeLoudness(dry, wet, sampleRate, { check });
  onProgress(1.0);

  return { dry, wet, sampleRate, loud };
}
