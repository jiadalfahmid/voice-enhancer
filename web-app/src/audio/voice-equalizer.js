// Voice Equalizer: 5-band voice-tailored parametric equalizer using RBJ Audio EQ Cookbook biquads.
// Bands: Low-Cut (HPF), Warmth (220 Hz), De-Mud (600 Hz), Presence (3 kHz), Air (10 kHz).

export const VOICE_EQ_PRESETS = {
  flat: {
    label: 'Flat',
    hpf: 80,
    warmth: 0,
    demud: 0,
    presence: 0,
    air: 0,
  },
  podcast: {
    label: 'Podcast / Broadcast',
    hpf: 80,
    warmth: 1.5,
    demud: -2.0,
    presence: 2.5,
    air: 2.0,
  },
  crisp: {
    label: 'Crisp & Modern',
    hpf: 100,
    warmth: -1.0,
    demud: -2.5,
    presence: 3.0,
    air: 3.5,
  },
  warm: {
    label: 'Warm & Intimate',
    hpf: 80,
    warmth: 3.0,
    demud: -1.0,
    presence: 1.0,
    air: 1.0,
  },
  debox: {
    label: 'De-Box Mud',
    hpf: 80,
    warmth: 0.0,
    demud: -4.0,
    presence: 1.5,
    air: 1.0,
  },
};

/**
 * RBJ Peaking EQ biquad filter.
 */
export function biquadPeaking(fs, f, gainDb, q = 1.0) {
  if (Math.abs(gainDb) < 1e-4) return null; // bypass if gain is 0 dB
  const safeF = Math.min(f, 0.45 * fs);
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * safeF) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);

  const a0 = 1 + alpha / A;
  const b0 = (1 + alpha * A) / a0;
  const b1 = (-2 * c) / a0;
  const b2 = (1 - alpha * A) / a0;
  const a1 = (-2 * c) / a0;
  const a2 = (1 - alpha / A) / a0;

  return { b: [b0, b1, b2], a: [a1, a2] };
}

/**
 * RBJ High-Pass biquad filter.
 */
export function biquadHighPass(fs, f, q = 0.7071) {
  if (!(f > 10)) return null;
  const safeF = Math.min(f, 0.45 * fs);
  const w0 = (2 * Math.PI * safeF) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);

  const a0 = 1 + alpha;
  const b0 = (1 + c) / (2 * a0);
  const b1 = -(1 + c) / a0;
  const b2 = (1 + c) / (2 * a0);
  const a1 = (-2 * c) / a0;
  const a2 = (1 - alpha) / a0;

  return { b: [b0, b1, b2], a: [a1, a2] };
}

/**
 * RBJ High-Shelf biquad filter.
 */
export function biquadHighShelf(fs, f, gainDb, q = 0.7071) {
  if (Math.abs(gainDb) < 1e-4) return null;
  const safeF = Math.min(f, 0.45 * fs);
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * safeF) / fs;
  const c = Math.cos(w0);
  const s = Math.sin(w0);
  const alpha = (s / 2) * Math.sqrt((A + 1 / A) * (1 / q - 1) + 2);
  const twoRootAAlpha = 2 * Math.sqrt(A) * alpha;

  const a0 = (A + 1) - (A - 1) * c + twoRootAAlpha;
  const b0 = (A * ((A + 1) + (A - 1) * c + twoRootAAlpha)) / a0;
  const b1 = (-2 * A * ((A - 1) + (A + 1) * c)) / a0;
  const b2 = (A * ((A + 1) + (A - 1) * c - twoRootAAlpha)) / a0;
  const a1 = (2 * ((A - 1) - (A + 1) * c)) / a0;
  const a2 = ((A + 1) - (A - 1) * c - twoRootAAlpha) / a0;

  return { b: [b0, b1, b2], a: [a1, a2] };
}

/**
 * Direct Form II Transposed biquad filter in place on an array.
 */
export function applyBiquadInPlace(x, filter) {
  if (!filter) return;
  const { b, a } = filter;
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const o = b[0] * v + z1;
    z1 = b[1] * v - a[0] * o + z2;
    z2 = b[2] * v - a[1] * o;
    x[i] = o;
  }
}

/**
 * Equalize multi-channel voice audio.
 *
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {Object} [params]
 * @param {number} [params.hpf=80] - High-pass cutoff Hz (0 or <10 to disable).
 * @param {number} [params.warmth=0] - Warmth / chest (220 Hz) gain dB.
 * @param {number} [params.demud=0] - De-mud / boxiness (600 Hz) gain dB.
 * @param {number} [params.presence=0] - Presence / articulation (3 kHz) gain dB.
 * @param {number} [params.air=0] - Air / brilliance (10 kHz) gain dB.
 * @returns {Float32Array[]} New channels array.
 */
export function equalizeVoice(channels, sampleRate, params = {}) {
  const {
    hpf = 80,
    warmth = 0,
    demud = 0,
    presence = 0,
    air = 0,
  } = params;

  if (!channels || channels.length === 0 || channels[0].length === 0) {
    return channels ? channels.map((c) => new Float32Array(c)) : [];
  }

  // Build filter chain
  const filters = [];

  const hpfFilter = biquadHighPass(sampleRate, hpf);
  if (hpfFilter) filters.push(hpfFilter);

  const warmthFilter = biquadPeaking(sampleRate, 220, warmth, 0.8);
  if (warmthFilter) filters.push(warmthFilter);

  const demudFilter = biquadPeaking(sampleRate, 600, demud, 1.0);
  if (demudFilter) filters.push(demudFilter);

  const presenceFilter = biquadPeaking(sampleRate, 3000, presence, 1.0);
  if (presenceFilter) filters.push(presenceFilter);

  // Air band: 10 kHz shelf or safe clamped high peaking
  const airFilter = sampleRate >= 24000
    ? biquadHighShelf(sampleRate, 10000, air, 0.7)
    : biquadPeaking(sampleRate, Math.min(7200, 0.45 * sampleRate), air, 1.0);
  if (airFilter) filters.push(airFilter);

  // If no filters needed, return clones
  if (filters.length === 0) {
    return channels.map((c) => new Float32Array(c));
  }

  // Clone channels and apply each filter in sequence
  const out = channels.map((c) => new Float32Array(c));
  for (const ch of out) {
    for (const flt of filters) {
      applyBiquadInPlace(ch, flt);
    }
  }

  return out;
}
