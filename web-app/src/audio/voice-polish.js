// Voice Polish: Combines the 5-band voice equalizer and speech-gated dynamic balancer.
import { equalizeVoice, VOICE_EQ_PRESETS } from './voice-equalizer.js';
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
