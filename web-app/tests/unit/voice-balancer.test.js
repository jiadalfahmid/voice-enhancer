import { describe, it, expect } from 'vitest';
import { balanceVoice } from '../../src/audio/voice-balancer.js';

describe('Voice Balancer (Speech-Gated Dynamic Leveler)', () => {
  const sampleRate = 16000;

  function makeSine(freq, durSec, amp) {
    const n = Math.round(durSec * sampleRate);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
    return x;
  }

  function measureRms(arr) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
    return Math.sqrt(s / arr.length);
  }

  it('bypasses when strength is 0', () => {
    const sine = makeSine(440, 1.0, 0.1);
    const out = balanceVoice([sine], sampleRate, { strength: 0 });
    expect(out.length).toBe(1);
    expect(out[0].length).toBe(sine.length);
    for (let i = 0; i < sine.length; i++) {
      expect(out[0][i]).toBeCloseTo(sine[i], 5);
    }
  });

  it('levels quiet speech upward and loud speech downward', () => {
    // 1 second of loud tone (amplitude 0.5 ~ -6 dBFS peak) followed by
    // 1 second of quiet tone (amplitude 0.02 ~ -34 dBFS peak)
    const loud = makeSine(300, 1.0, 0.5);
    const quiet = makeSine(300, 1.0, 0.02);
    const combined = new Float32Array(loud.length + quiet.length);
    combined.set(loud, 0);
    combined.set(quiet, loud.length);

    const out = balanceVoice([combined], sampleRate, {
      strength: 0.8,
      targetRmsDb: -20,
      attackMs: 50,
      releaseMs: 200,
    });

    expect(out[0].length).toBe(combined.length);

    // Measure loud portion (middle 500 ms) and quiet portion (middle 500 ms)
    const origLoudRms = measureRms(combined.subarray(250 * 16, 750 * 16));
    const origQuietRms = measureRms(combined.subarray(1250 * 16, 1750 * 16));
    const origRatio = origLoudRms / origQuietRms;

    const outLoudRms = measureRms(out[0].subarray(250 * 16, 750 * 16));
    const outQuietRms = measureRms(out[0].subarray(1250 * 16, 1750 * 16));
    const outRatio = outLoudRms / outQuietRms;

    // Leveler should significantly compress the dynamic difference
    expect(outRatio).toBeLessThan(origRatio * 0.5);
    // Quiet section should have been boosted
    expect(outQuietRms).toBeGreaterThan(origQuietRms * 1.5);
  });

  it('anti-pumping: does NOT boost silence or noise below gate threshold', () => {
    // 1 second of speech tone, followed by 1 second of quiet noise / silence (e.g. amplitude 0.001 ~ -60 dBFS)
    const speech = makeSine(400, 1.0, 0.1);
    const silence = makeSine(400, 1.0, 0.001); // -60 dBFS, below gate threshold of -42 dBFS
    const combined = new Float32Array(speech.length + silence.length);
    combined.set(speech, 0);
    combined.set(silence, speech.length);

    const out = balanceVoice([combined], sampleRate, {
      strength: 0.8,
      gateThresholdDb: -42,
      targetRmsDb: -20,
    });

    const origSilenceRms = measureRms(combined.subarray(1250 * 16, 1750 * 16));
    const outSilenceRms = measureRms(out[0].subarray(1250 * 16, 1750 * 16));

    // Silence must NOT be amplified by +8 dB (which would be ~2.5x)!
    // It should stay close to 1.0x (unity gain or less).
    expect(outSilenceRms).toBeLessThanOrEqual(origSilenceRms * 1.25);
  });

  it('preserves stereo channel length and stereo balance', () => {
    const left = makeSine(200, 0.5, 0.1);
    const right = makeSine(400, 0.5, 0.05);

    const out = balanceVoice([left, right], sampleRate, { strength: 0.7 });
    expect(out.length).toBe(2);
    expect(out[0].length).toBe(left.length);
    expect(out[1].length).toBe(right.length);
  });
});
