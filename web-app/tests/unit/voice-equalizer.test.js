import { describe, it, expect } from 'vitest';
import { equalizeVoice, VOICE_EQ_PRESETS, biquadPeaking, biquadHighPass, biquadHighShelf } from '../../src/audio/voice-equalizer.js';

describe('Voice Equalizer (5-Band Voice EQ)', () => {
  function makeSine(freq, durSec, amp, fs) {
    const n = Math.round(durSec * fs);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = amp * Math.sin((2 * Math.PI * freq * i) / fs);
    }
    return x;
  }

  function measureRms(arr) {
    let s = 0;
    // skip initial 200 samples to avoid filter turn-on transient
    const start = Math.min(200, Math.floor(arr.length / 4));
    for (let i = start; i < arr.length; i++) s += arr[i] * arr[i];
    return Math.sqrt(s / (arr.length - start));
  }

  it('returns exact copy when all bands are 0 dB and HPF is off', () => {
    const fs = 16000;
    const tone = makeSine(440, 0.2, 0.2, fs);
    const out = equalizeVoice([tone], fs, { hpf: 0, warmth: 0, demud: 0, presence: 0, air: 0 });
    expect(out[0].length).toBe(tone.length);
    for (let i = 0; i < tone.length; i++) {
      expect(out[0][i]).toBeCloseTo(tone[i], 5);
    }
  });

  it('HPF 80 Hz attenuates 30 Hz sub-rumble while passing 500 Hz speech tone', () => {
    const fs = 48000;
    const rumble = makeSine(30, 0.5, 0.2, fs);
    const voice = makeSine(500, 0.5, 0.2, fs);

    const outRumble = equalizeVoice([rumble], fs, { hpf: 80, warmth: 0, demud: 0, presence: 0, air: 0 });
    const outVoice = equalizeVoice([voice], fs, { hpf: 80, warmth: 0, demud: 0, presence: 0, air: 0 });

    const rumbleInRms = measureRms(rumble);
    const rumbleOutRms = measureRms(outRumble[0]);
    expect(rumbleOutRms).toBeLessThan(rumbleInRms * 0.4); // > -8 dB attenuation at 30 Hz

    const voiceInRms = measureRms(voice);
    const voiceOutRms = measureRms(outVoice[0]);
    expect(voiceOutRms).toBeCloseTo(voiceInRms, 2); // 500 Hz passed unattenuated
  });

  it('Warmth band boosts 220 Hz when positive', () => {
    const fs = 16000;
    const tone = makeSine(220, 0.5, 0.1, fs);
    const out = equalizeVoice([tone], fs, { hpf: 0, warmth: 6, demud: 0, presence: 0, air: 0 });
    const inRms = measureRms(tone);
    const outRms = measureRms(out[0]);
    // +6 dB is roughly a factor of 2 in linear amplitude
    expect(outRms).toBeGreaterThan(inRms * 1.7);
  });

  it('De-mud band attenuates 600 Hz when negative', () => {
    const fs = 16000;
    const tone = makeSine(600, 0.5, 0.1, fs);
    const out = equalizeVoice([tone], fs, { hpf: 0, warmth: 0, demud: -6, presence: 0, air: 0 });
    const inRms = measureRms(tone);
    const outRms = measureRms(out[0]);
    // -6 dB is roughly a factor of 0.5 in linear amplitude
    expect(outRms).toBeLessThan(inRms * 0.6);
  });

  it('Presence band boosts 3000 Hz', () => {
    const fs = 48000;
    const tone = makeSine(3000, 0.5, 0.1, fs);
    const out = equalizeVoice([tone], fs, { hpf: 0, warmth: 0, demud: 0, presence: 4, air: 0 });
    const inRms = measureRms(tone);
    const outRms = measureRms(out[0]);
    expect(outRms).toBeGreaterThan(inRms * 1.4);
  });

  it('Air band works safely on 48 kHz (shelf) and 16 kHz (clamped peaking) without NaNs', () => {
    // 48 kHz
    const fs48 = 48000;
    const tone48 = makeSine(10000, 0.3, 0.1, fs48);
    const out48 = equalizeVoice([tone48], fs48, { hpf: 80, warmth: 0, demud: 0, presence: 0, air: 4 });
    expect(Number.isFinite(out48[0][100])).toBe(true);
    // At shelf corner frequency (10 kHz), gain is half the shelf dB (+2 dB ~ 1.25x)
    expect(measureRms(out48[0])).toBeGreaterThan(measureRms(tone48) * 1.2);

    // Well above corner (15 kHz), gain reaches full shelf (+4 dB ~ 1.5x)
    const toneHigh = makeSine(15000, 0.3, 0.1, fs48);
    const outHigh = equalizeVoice([toneHigh], fs48, { hpf: 80, warmth: 0, demud: 0, presence: 0, air: 4 });
    expect(measureRms(outHigh[0])).toBeGreaterThan(measureRms(toneHigh) * 1.4);

    // 16 kHz: 10 kHz is above Nyquist (8 kHz), so it must clamp cleanly without throwing or producing NaN
    const fs16 = 16000;
    const tone16 = makeSine(6000, 0.3, 0.1, fs16);
    const out16 = equalizeVoice([tone16], fs16, { hpf: 80, warmth: 0, demud: 0, presence: 0, air: 4 });
    expect(Number.isFinite(out16[0][100])).toBe(true);
  });

  it('supports voice presets cleanly', () => {
    const fs = 48000;
    const tone = makeSine(1000, 0.2, 0.1, fs);
    for (const [key, preset] of Object.entries(VOICE_EQ_PRESETS)) {
      const out = equalizeVoice([tone], fs, preset);
      expect(out.length).toBe(1);
      expect(out[0].length).toBe(tone.length);
      expect(Number.isFinite(out[0][50])).toBe(true);
    }
  });
});
