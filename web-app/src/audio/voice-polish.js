// Voice Polish: Combines the 5-band voice equalizer and speech-gated dynamic balancer.
import {
  equalizeVoice,
  VOICE_EQ_PRESETS,
  biquadHighPass,
  biquadPeaking,
  biquadHighShelf,
  applyBiquadInPlace,
} from './voice-equalizer.js';
import { balanceVoice } from './voice-balancer.js';

export { VOICE_EQ_PRESETS };

/**
 * Apply equalizer and/or voice balancer to audio channels.
 *
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {Object} [options]
 * @param {Object} [options.balancer]
 * @param {boolean} [options.balancer.enabled=true]
 * @param {number} [options.balancer.strength=0.75]
 * @param {Object} [options.equalizer]
 * @param {boolean} [options.equalizer.enabled=true]
 * @param {number} [options.equalizer.hpf=80]
 * @param {number} [options.equalizer.warmth=0]
 * @param {number} [options.equalizer.demud=0]
 * @param {number} [options.equalizer.presence=0]
 * @param {number} [options.equalizer.air=0]
 * @returns {Float32Array[]}
 */
export function applyVoicePolish(channels, sampleRate, options = {}) {
  const {
    balancer = { enabled: true, strength: 0.75 },
    equalizer = { enabled: true, ...VOICE_EQ_PRESETS.podcast },
  } = options;

  let cur = channels;

  // 1. Voice Equalizer pass (cleans rumble, shapes tonal clarity)
  if (equalizer && equalizer.enabled !== false) {
    cur = equalizeVoice(cur, sampleRate, equalizer);
  }

  // 2. Voice Balancer pass (levels phrases dynamically without noise pumping)
  if (balancer && balancer.enabled !== false && (balancer.strength ?? 0.75) > 0) {
    cur = balanceVoice(cur, sampleRate, balancer);
  }

  return cur;
}

/**
 * Asynchronously apply equalizer and balancer in chunks to avoid blocking the UI thread.
 *
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {Object} [options]
 * @param {Object} [control]
 * @param {Function} [control.onProgress]
 * @param {AbortSignal} [control.signal]
 * @returns {Promise<Float32Array[]>}
 */
export async function applyVoicePolishAsync(channels, sampleRate, options = {}, { onProgress, signal } = {}) {
  const {
    balancer = { enabled: true, strength: 0.75 },
    equalizer = { enabled: true, ...VOICE_EQ_PRESETS.podcast },
  } = options;

  const eqActive = equalizer && equalizer.enabled !== false;
  const balActive = balancer && balancer.enabled !== false && (balancer.strength ?? 0.75) > 0;

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(0.02);

  let cur = channels;

  // 1. Equalizer pass
  if (eqActive) {
    if (!cur || cur.length === 0 || cur[0].length === 0) {
      cur = cur ? cur.map((c) => new Float32Array(c)) : [];
    } else {
      const {
        hpf = 80,
        warmth = 0,
        demud = 0,
        presence = 0,
        air = 0,
      } = equalizer;

      const filters = [];
      const hpfFilter = biquadHighPass(sampleRate, hpf);
      if (hpfFilter) filters.push(hpfFilter);
      const warmthFilter = biquadPeaking(sampleRate, 220, warmth, 0.8);
      if (warmthFilter) filters.push(warmthFilter);
      const demudFilter = biquadPeaking(sampleRate, 600, demud, 1.0);
      if (demudFilter) filters.push(demudFilter);
      const presenceFilter = biquadPeaking(sampleRate, 3000, presence, 1.0);
      if (presenceFilter) filters.push(presenceFilter);
      const airFilter = sampleRate >= 24000
        ? biquadHighShelf(sampleRate, 10000, air, 0.7)
        : biquadPeaking(sampleRate, Math.min(7200, 0.45 * sampleRate), air, 1.0);
      if (airFilter) filters.push(airFilter);

      cur = cur.map((c) => new Float32Array(c));
      const totalSteps = cur.length * Math.max(1, filters.length);
      let stepCount = 0;

      for (const ch of cur) {
        for (const flt of filters) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          applyBiquadInPlace(ch, flt);
          stepCount++;
          const weight = balActive ? 0.3 : 0.95;
          onProgress?.(0.05 + weight * (stepCount / totalSteps));
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // 2. Balancer pass
  if (balActive) {
    if (!cur || cur.length === 0 || cur[0].length === 0) {
      cur = cur ? cur.map((c) => new Float32Array(c)) : [];
    } else {
      const {
        strength = 0.75,
        targetRmsDb = -20,
        gateThresholdDb = -42,
        maxBoostDb = 8,
        maxCutDb = -8,
        attackMs = 100,
        releaseMs = 600,
      } = balancer;

      const numChannels = cur.length;
      const numSamples = cur[0].length;

      const hop = Math.max(1, Math.round(0.025 * sampleRate));
      const win = Math.max(hop, Math.round(0.05 * sampleRate));
      const halfWin = Math.floor(win / 2);
      const numFrames = Math.max(1, Math.floor((numSamples - 1) / hop) + 1);

      const frameGains = new Float32Array(numFrames);

      const dt = hop / sampleRate;
      const alphaAtt = Math.exp(-dt / Math.max(0.001, attackMs / 1000));
      const alphaRel = Math.exp(-dt / Math.max(0.001, releaseMs / 1000));

      const effMaxBoost = maxBoostDb * strength;
      const effMaxCut = maxCutDb * strength;

      let currentGain = 1.0;

      const baseProg = eqActive ? 0.35 : 0.05;
      const spanProg = eqActive ? 0.60 : 0.90;

      // Frame analysis with chunked yields
      const FRAME_CHUNK = 800;
      for (let f = 0; f < numFrames; f++) {
        const center = f * hop;
        const start = Math.max(0, center - halfWin);
        const end = Math.min(numSamples, center + halfWin);
        const count = end - start;

        let sumSq = 0;
        if (count > 0) {
          for (let ch = 0; ch < numChannels; ch++) {
            const cData = cur[ch];
            for (let i = start; i < end; i++) {
              const s = cData[i];
              sumSq += s * s;
            }
          }
          sumSq /= (count * numChannels);
        }

        const rmsDb = 10 * Math.log10(Math.max(1e-12, sumSq));

        let rawGain = 1.0;
        if (rmsDb >= gateThresholdDb) {
          const deltaDb = (targetRmsDb - rmsDb) * strength;
          const clampedDb = Math.max(effMaxCut, Math.min(effMaxBoost, deltaDb));
          rawGain = Math.pow(10, clampedDb / 20);
        } else {
          rawGain = 1.0;
        }

        if (rawGain < currentGain) {
          currentGain = (1 - alphaAtt) * rawGain + alphaAtt * currentGain;
        } else {
          currentGain = (1 - alphaRel) * rawGain + alphaRel * currentGain;
        }

        frameGains[f] = currentGain;

        if (f % FRAME_CHUNK === 0) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          onProgress?.(baseProg + spanProg * 0.5 * (f / numFrames));
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      // Sample interpolation with chunked yields
      const out = Array.from({ length: numChannels }, () => new Float32Array(numSamples));
      const SAMPLE_CHUNK = 120000;

      for (let i = 0; i < numSamples; i++) {
        const fPos = i / hop;
        const f0 = Math.min(numFrames - 1, Math.floor(fPos));
        const f1 = Math.min(numFrames - 1, f0 + 1);
        const frac = fPos - f0;
        const g = frameGains[f0] * (1 - frac) + frameGains[f1] * frac;

        for (let ch = 0; ch < numChannels; ch++) {
          let val = cur[ch][i] * g;
          if (val > 0.95) {
            val = 0.95 + 0.05 * Math.tanh((val - 0.95) / 0.05);
          } else if (val < -0.95) {
            val = -0.95 + 0.05 * Math.tanh((val + 0.95) / 0.05);
          }
          out[ch][i] = val;
        }

        if (i % SAMPLE_CHUNK === 0) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          onProgress?.(baseProg + spanProg * (0.5 + 0.5 * (i / numSamples)));
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      cur = out;
    }
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(1.0);
  return cur;
}
