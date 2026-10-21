// Dedicated file-mode pipeline for DPDFNet 48 kHz.
// Uses dedicated 960-point Vorbis STFT/ISTFT, preserves recurrent state, and integrates
// with shared resampling, cancellation, progress reporting, and loudness analysis.

import { highPass } from './hpf.js';
import { resampleChunked } from './resample-async.js';
import {
  dpdfnet48kPreprocessWaveform,
  dpdfnet48kPostprocessSpec,
  DPDFNET48K_BINS,
} from './dpdfnet48k-stft.js';
import { analyzeLoudness } from './loudness-cache.js';
import { applyClarity } from './postprocess.js';
import { CancelledError } from './pipeline.js';

export const DPDFNET48K_MODEL_RATE = 48000;

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
 * Enhance one channel at 48 kHz using DPDFNet 48k STFT, model inference, and ISTFT alignment.
 * @param {Float32Array} x48 - 48 kHz mono waveform
 * @param {object} model - DPDFNet 48k model adapter
 * @param {object} callbacks - { check, onProgress }
 * @returns {Promise<Float32Array>} 48 kHz enhanced waveform of exact same length
 */
async function enhanceChannel48k(x48, model, { check = () => {}, onProgress = () => {} } = {}) {
  check();
  const len = x48.length;
  const { re, im, frames } = dpdfnet48kPreprocessWaveform(x48);

  const state = model.createState();
  const outRe = new Float32Array(frames * DPDFNET48K_BINS);
  const outIm = new Float32Array(frames * DPDFNET48K_BINS);

  // Process frames in blocks to yield to UI and report progress
  const BLOCK_FRAMES = 50;
  for (let startFrame = 0; startFrame < frames; startFrame += BLOCK_FRAMES) {
    await tick();
    check();
    const count = Math.min(BLOCK_FRAMES, frames - startFrame);
    const subRe = re.subarray(startFrame * DPDFNET48K_BINS, (startFrame + count) * DPDFNET48K_BINS);
    const subIm = im.subarray(startFrame * DPDFNET48K_BINS, (startFrame + count) * DPDFNET48K_BINS);

    const blockRes = await model.process(subRe, subIm, count, state, { tick });
    outRe.set(blockRes.re, startFrame * DPDFNET48K_BINS);
    outIm.set(blockRes.im, startFrame * DPDFNET48K_BINS);

    onProgress((startFrame + count) / frames);
  }

  return dpdfnet48kPostprocessSpec(outRe, outIm, frames, len);
}

/**
 * Enhance audio file using DPDFNet 48 kHz.
 * Returns cache { dry, wet, sampleRate, loud } compatible with renderOutput / renderWindow.
 */
export async function enhanceFileDpdfnet48k({
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

  // 1. High-pass filter (on model input only; dry remains untouched)
  const hpfDry = proc.map((x) => highPass(x, sampleRate, hpf));
  check();

  // 2. Resample to 48 kHz if needed
  const x48 = [];
  for (let c = 0; c < nCh; c++) {
    if (sampleRate === DPDFNET48K_MODEL_RATE) {
      x48.push(hpfDry[c]);
    } else {
      const resampled = await resampleChunked(hpfDry[c], sampleRate, DPDFNET48K_MODEL_RATE, { check });
      x48.push(resampled);
    }
    onProgress(0.01 + 0.08 * ((c + 1) / nCh));
  }
  check();

  // 3. Run DPDFNet 48k enhancement
  onStatus('Enhancing with DPDFNet 48 kHz...');
  const enh48 = [];
  for (let c = 0; c < nCh; c++) {
    const chOut = await enhanceChannel48k(x48[c], model, {
      check,
      onProgress: (frac) => onProgress(0.09 + 0.70 * ((c + frac) / nCh)),
    });
    enh48.push(chOut);
  }
  check();

  // 4. Resample back to original sample rate if needed
  onStatus('Resampling output...');
  let wet = [];
  for (let c = 0; c < nCh; c++) {
    if (sampleRate === DPDFNET48K_MODEL_RATE) {
      wet.push(fitLength(enh48[c], len));
    } else {
      const up = await resampleChunked(enh48[c], DPDFNET48K_MODEL_RATE, sampleRate, { check });
      wet.push(fitLength(up, len));
    }
    onProgress(0.80 + 0.12 * ((c + 1) / nCh));
  }
  check();

  // 5. Optional time-domain clarity
  if (clarity) {
    for (const w of wet) applyClarity(w, sampleRate);
  }

  // 6. Multi-channel mapping if mono option was selected
  if (proc !== channels) {
    wet = channels.map(() => wet[0]);
  }

  // 7. Loudness analysis for rendering/sliders
  onStatus('Analyzing loudness...');
  const loud = await analyzeLoudness(dry, wet, sampleRate, { check });
  onProgress(1.0);

  return { dry, wet, sampleRate, loud };
}
