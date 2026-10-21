// Presets (F12) and persisted settings. Process-time fields apply when a file is chosen;
// strength/target are render-time. PRD does not define the values; these are starting points to tune by ear.
// Natural = model only, no extra polish (the default). The DSP polish stages (echo reduction, strong depth) are
// experimental and can add watery artifacts, so only the explicitly experimental presets enable them.
export const PRESETS = {
  natural: { label: 'Natural (recommended)', hpf: true, strength: 100, target: -16, depth: 'standard', echo: 'off', clarity: false, mono: false },
  podcast: { label: 'Podcast', hpf: true, strength: 100, target: -16, depth: 'standard', echo: 'off', clarity: true, mono: true },
  call: { label: 'Strong cleanup (experimental)', hpf: true, strength: 100, target: -19, depth: 'strong', echo: 'off', clarity: false, mono: true },
  room: { label: 'Room echo (experimental, may sound watery)', hpf: true, strength: 100, target: -16, depth: 'standard', echo: 'low', clarity: false, mono: true },
  voicenote: { label: 'Voice note', hpf: true, strength: 100, target: -16, depth: 'standard', echo: 'off', clarity: false, mono: true },
};
export const DEFAULTS = { hpf: true, strength: 100, target: -16, depth: 'standard', echo: 'off', clarity: false, mono: false, engine: 'gtcrn' };
const KEY = 'voice-enhancer:settings:v1';

export function applyPreset(settings, id) {
  const { label, ...p } = PRESETS[id];
  return { ...settings, ...p };
}

let _sessionSettings = null;

export function loadSettings(storage = null) {
  if (storage) {
    try {
      const raw = storage.getItem(KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch { return { ...DEFAULTS }; }
  }
  return _sessionSettings ? { ...DEFAULTS, ..._sessionSettings } : { ...DEFAULTS };
}

export function saveSettings(settings, storage = null) {
  if (storage) {
    try { storage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  } else {
    _sessionSettings = { ...settings };
  }
}
