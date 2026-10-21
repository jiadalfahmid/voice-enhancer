import type { EngineInfo } from './types.ts';

/**
 * Catalogue of engines the UI can show. `availability` tells users the truth about each one (plan section 2):
 * only 'browser-ready' engines get a Process button. Licenses stay 'unverified' until checked against the real weights.
 */
export const ENGINE_CATALOG: EngineInfo[] = [
  { id: 'gtcrn', label: 'GTCRN (pretrained)', availability: 'browser-ready', runtime: 'ort-web', sampleRate: 16000, license: 'MIT', approxSizeMB: 0.5, notes: 'Tiny and fast; reference baseline.' },
  { id: 'deepfilternet3', label: 'DeepFilterNet3', availability: 'browser-ready', runtime: 'wasm', sampleRate: 48000, license: 'MIT OR Apache-2.0', approxSizeMB: 24.4, notes: 'Full-band 48 kHz deep filtering speech enhancement engine.' },
  { id: 'dpdfnet-16k', label: 'DPDFNet 16 kHz', availability: 'browser-ready', runtime: 'ort-web', sampleRate: 16000, license: 'Apache-2.0 (code; weights unverified)', approxSizeMB: 8.4, notes: 'Recurrent dual-path model with 320-point Vorbis STFT.' },
  { id: 'dpdfnet-48k', label: 'DPDFNet 48 kHz', availability: 'browser-ready', runtime: 'ort-web', sampleRate: 48000, license: 'Apache-2.0', approxSizeMB: 10.5, notes: 'Full-band 48 kHz recurrent dual-path model with 960-point Vorbis STFT.' },
];

export const availabilityLabel = (a: EngineInfo['availability']) =>
  a === 'browser-ready' ? 'Runs in your browser' : a === 'local-offline' ? 'Offline only (import its result)' : 'Not yet supported';

export const isRunnable = (e: EngineInfo) => e.availability === 'browser-ready';
