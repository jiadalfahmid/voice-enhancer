// Voice Balancer: Speech-gated dynamic leveler (auto-gain) that smooths vocal level variations
// across phrases without noise pumping or breathing during pauses.

/**
 * @typedef {Object} BalancerOptions
 * @property {number} [strength=0.75] - Leveling strength from 0 (bypass) to 1 (full leveling).
 * @property {number} [targetRmsDb=-20] - Target dialogue RMS in dBFS.
 * @property {number} [gateThresholdDb=-42] - Speech threshold; frames below this are not boosted.
 * @property {number} [maxBoostDb=8] - Maximum boost for quiet speech in dB.
 * @property {number} [maxCutDb=-8] - Maximum attenuation for loud speech in dB.
 * @property {number} [attackMs=100] - Fast smoothing attack time constant in ms.
 * @property {number} [releaseMs=600] - Gradual smoothing release time constant in ms.
 */

/**
 * Apply speech-gated dynamic leveling to multi-channel audio.
 * Returns a new array of Float32Array channels.
 *
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {BalancerOptions} [options]
 * @returns {Float32Array[]}
 */
export function balanceVoice(channels, sampleRate, options = {}) {
  const {
    strength = 0.75,
    targetRmsDb = -20,
    gateThresholdDb = -42,
    maxBoostDb = 8,
    maxCutDb = -8,
    attackMs = 100,
    releaseMs = 600,
  } = options;

  if (!channels || channels.length === 0 || channels[0].length === 0) {
    return channels ? channels.map((c) => new Float32Array(c)) : [];
  }

  const numChannels = channels.length;
  const numSamples = channels[0].length;

  if (strength <= 0) {
    return channels.map((c) => new Float32Array(c));
  }

  // 50 ms analysis window, 25 ms hop
  const hop = Math.max(1, Math.round(0.025 * sampleRate));
  const win = Math.max(hop, Math.round(0.05 * sampleRate));
  const halfWin = Math.floor(win / 2);
  const numFrames = Math.max(1, Math.floor((numSamples - 1) / hop) + 1);

  const frameGains = new Float32Array(numFrames);

  // Time constants for ballistics
  const dt = hop / sampleRate;
  const alphaAtt = Math.exp(-dt / Math.max(0.001, attackMs / 1000));
  const alphaRel = Math.exp(-dt / Math.max(0.001, releaseMs / 1000));

  const effMaxBoost = maxBoostDb * strength;
  const effMaxCut = maxCutDb * strength;

  let currentGain = 1.0;

  for (let f = 0; f < numFrames; f++) {
    const center = f * hop;
    const start = Math.max(0, center - halfWin);
    const end = Math.min(numSamples, center + halfWin);
    const count = end - start;

    let sumSq = 0;
    if (count > 0) {
      for (let ch = 0; ch < numChannels; ch++) {
        const cData = channels[ch];
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
      // Active speech frame: target gain moves towards targetRmsDb
      const deltaDb = (targetRmsDb - rmsDb) * strength;
      const clampedDb = Math.max(effMaxCut, Math.min(effMaxBoost, deltaDb));
      rawGain = Math.pow(10, clampedDb / 20);
    } else {
      // In silence or quiet noise, relax smoothly toward 1.0 (0 dB) so noise is never amplified
      rawGain = 1.0;
    }

    // Envelope ballistics (attack when attenuating, release when boosting)
    if (rawGain < currentGain) {
      currentGain = (1 - alphaAtt) * rawGain + alphaAtt * currentGain;
    } else {
      currentGain = (1 - alphaRel) * rawGain + alphaRel * currentGain;
    }

    frameGains[f] = currentGain;
  }

  // Generate output with sample-accurate linear interpolation between frame centers
  const out = Array.from({ length: numChannels }, () => new Float32Array(numSamples));

  for (let i = 0; i < numSamples; i++) {
    const fPos = i / hop;
    const f0 = Math.min(numFrames - 1, Math.floor(fPos));
    const f1 = Math.min(numFrames - 1, f0 + 1);
    const frac = fPos - f0;
    const g = frameGains[f0] * (1 - frac) + frameGains[f1] * frac;

    for (let ch = 0; ch < numChannels; ch++) {
      let val = channels[ch][i] * g;
      // Soft saturation to prevent harsh clipping if loud sudden peaks occur
      if (val > 0.95) {
        val = 0.95 + 0.05 * Math.tanh((val - 0.95) / 0.05);
      } else if (val < -0.95) {
        val = -0.95 + 0.05 * Math.tanh((val + 0.95) / 0.05);
      }
      out[ch][i] = val;
    }
  }

  return out;
}
