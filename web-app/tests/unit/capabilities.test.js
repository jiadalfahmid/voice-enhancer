import { describe, it, expect } from 'vitest';
import { pickWasmThreads, detectCapabilities } from '../../src/audio/capabilities.js';

describe('pickWasmThreads', () => {
  it('is 1 when not isolated', () => expect(pickWasmThreads(false, 8)).toBe(1));
  it('caps at 4 when isolated', () => expect(pickWasmThreads(true, 16)).toBe(4));
  it('uses core count below the cap', () => expect(pickWasmThreads(true, 2)).toBe(2));
});

describe('detectCapabilities', () => {
  it('falls back to compatibility live mode without isolation', () => {
    const c = detectCapabilities({ crossOriginIsolated: false, AudioWorklet: class {}, navigator: { hardwareConcurrency: 8 } });
    expect(c.liveMode).toBe('compatibility');
    expect(c.wasmThreads).toBe(1);
  });
  it('disables live mode without AudioWorklet', () => {
    const c = detectCapabilities({ crossOriginIsolated: true, SharedArrayBuffer, navigator: {} });
    expect(c.liveMode).toBe('disabled');
  });
});
