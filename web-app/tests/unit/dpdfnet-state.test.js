import { describe, it, expect } from 'vitest';
import { createDpdfnetInitialState, DPDFNET_STATE_SIZE } from '../../src/audio/dpdfnet-state.js';

describe('DPDFNet initial state', () => {
  it('creates Float32Array with exactly DPDFNET_STATE_SIZE elements', () => {
    expect(DPDFNET_STATE_SIZE).toBe(38256);
    const state = createDpdfnetInitialState();
    expect(state).toBeInstanceOf(Float32Array);
    expect(state.length).toBe(38256);
  });

  it('initializes ERB norm values at offset 0 (32 elements)', () => {
    const state = createDpdfnetInitialState();
    expect(state[0]).toBeCloseTo(-60.0, 4);
    expect(state[31]).toBeCloseTo(-90.0, 4);
    // Monotonically decreasing
    for (let i = 1; i < 32; i++) {
      expect(state[i]).toBeLessThan(state[i - 1]);
    }
  });

  it('initializes spec norm values at offset 32 (96 elements)', () => {
    const state = createDpdfnetInitialState();
    expect(state[32]).toBeCloseTo(0.001, 5);
    expect(state[32 + 95]).toBeCloseTo(0.0001, 5);
    // Monotonically decreasing
    for (let i = 33; i < 32 + 96; i++) {
      expect(state[i]).toBeLessThan(state[i - 1]);
    }
  });

  it('leaves the remaining 38128 state elements at zero', () => {
    const state = createDpdfnetInitialState();
    let nonZeroCount = 0;
    for (let i = 128; i < state.length; i++) {
      if (state[i] !== 0) nonZeroCount++;
    }
    expect(nonZeroCount).toBe(0);
  });
});
