// Dedicated file-mode pipeline for DPDFNet 16 kHz.
// Uses dedicated 320-point Vorbis STFT/ISTFT, preserves recurrent state, and integrates
// with shared resampling, cancellation, progress reporting, and loudness analysis.
import { highPass } from './hpf.js';
import { resampleChunked } from './resample-async.js';
import {
  dpdfnetPreprocessWaveform,
  dpdfnetPostprocessSpec,
  fitLength,
  DPDFNET_BINS,
} from './dpdfnet-stft.js';
import { analyzeLoudness } from './loudness-cache.js';
import { applyClarity } from './postprocess.js';
import { CancelledError } from './pipeline.js';

export const DPDFNET_MODEL_RATE = 16000;

const tick = () => new Promise((r) => setTimeout(r, 0));

const downmix = (chs) => {
  const m = new Float32Array(chs[0].length);
  for (const x of chs) {
    for (let i = 0; i < m.length; i++) m[i] += x[i] / chs.length;
  }
  return m;
};

/**
 * Enhance one channel at 16 kHz using DPDFNet STFT, model inference, and ISTFT alignment.
 * @param {Float32Array} x16 - 16 kHz mono waveform
 * @param {object} model - DPDFNet model adapter
 * @param {object} callbacks - { check, onProgress }
 * @returns {Promise<Float32Array>} 16 kHz enhanced waveform of exact same length
 */
async function enhanceChannel16k(x16, model, { check = () => {}, onProgress = () => {} } = {}) {
  check();
  const len = x16.length;
  const { re, im, frames } = dpdfnetPreprocessWaveform(x16);

  const state = model.createState();
  const outRe = new Float32Array(frames * DPDFNET_BINS);
  const outIm = new Float32Array(frames * DPDFNET_BINS);

  // Process frames in blocks to yield to UI and report progress
  const BLOCK_FRAMES = 50;
  for (let startFrame = 0; startFrame < frames; startFrame += BLOCK_FRAMES) {
    await tick();
    check();
    const count = Math.min(BLOCK_FRAMES, frames - startFrame);
    const subRe = re.subarray(startFrame * DPDFNET_BINS, (startFrame + count) * DPDFNET_BINS);
    const subIm = im.subarray(startFrame * DPDFNET_BINS, (startFrame + count) * DPDFNET_BINS);

    const blockRes = await model.process(subRe, subIm, count, state, { tick });
    outRe.set(blockRes.re, startFrame * DPDFNET_BINS);
    outIm.set(blockRes.im, startFrame * DPDFNET_BINS);

    onProgress((startFrame + count) / frames);
  }

  return dpdfnetPostprocessSpec(outRe, outIm, frames, len);
}

/**
 * Enhance audio file using DPDFNet 16 kHz.
 * Returns cache { dry, wet, sampleRate, loud } compatible with renderOutput / renderWindow.
 */
export async function enhanceFileDpdfnet({
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

  // 2. Resample to 16 kHz
  const x16 = [];
  for (let c = 0; c < nCh; c++) {
    const resampled = await resampleChunked(hpfDry[c], sampleRate, DPDFNET_MODEL_RATE, { check });
    x16.push(resampled);
    onProgress(0.01 + 0.08 * ((c + 1) / nCh));
  }
  check();

  // 3. Run DPDFNet enhancement
  onStatus('Enhancing with DPDFNet 16 kHz...');
  const enh16 = [];
  for (let c = 0; c < nCh; c++) {
    const chOut = await enhanceChannel16k(x16[c], model, {
      check,
      onProgress: (frac) => onProgress(0.09 + 0.70 * ((c + frac) / nCh)),
    });
    enh16.push(chOut);
  }
  check();

  // 4. Resample back to original sample rate
  onStatus('Resampling output...');
  let wet = [];
  for (let c = 0; c < nCh; c++) {
    const up = await resampleChunked(enh16[c], DPDFNET_MODEL_RATE, sampleRate, { check });
    wet.push(fitLength(up, len));
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
