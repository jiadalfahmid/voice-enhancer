import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDpdfnetModel } from '../../src/audio/dpdfnet.js';
import { DPDFNET_STATE_SIZE, createDpdfnetInitialState } from '../../src/audio/dpdfnet-state.js';

const golden = JSON.parse(readFileSync(new URL('../fixtures/dpdfnet_golden.json', import.meta.url), 'utf8'));
const modelBytes = readFileSync(new URL('../../public/models/dpdfnet_baseline.onnx', import.meta.url));

class MockTensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
  dispose() {}
}

describe('DPDFNet adapter plumbing (mock session)', () => {
  it('passes spec [1, 1, 161, 2] and state [38256], and feeds state_out back as state_in', async () => {
    const B = golden.bins, T = golden.T;
    let t = 0;
    let lastStateOut = null;

    const session = {
      inputNames: ['spec', 'state_in'],
      outputNames: ['spec_e', 'state_out'],
      async run(feeds) {
        expect(feeds.spec.dims).toEqual([1, 1, 161, 2]);
        expect(feeds.state_in.dims).toEqual([38256]);

        // First frame receives the initial state
        if (t === 0) {
          const init = createDpdfnetInitialState();
          expect(feeds.state_in.data[0]).toBeCloseTo(init[0], 5);
          expect(feeds.state_in.data[32]).toBeCloseTo(init[32], 5);
        } else {
          // Following frames receive the exact previous state_out
          expect(feeds.state_in.data[0]).toBe(lastStateOut[0]);
        }

        const outSpec = new Float32Array(161 * 2);
        for (let k = 0; k < B; k++) {
          outSpec[2 * k] = golden.enhRe[t * B + k];
          outSpec[2 * k + 1] = golden.enhIm[t * B + k];
        }

        const nextState = new Float32Array(DPDFNET_STATE_SIZE);
        nextState[0] = t + 1; // dummy marker to verify carry
        lastStateOut = nextState;
        t++;

        return {
          spec_e: new MockTensor('float32', outSpec, [1, 1, 161, 2]),
          state_out: new MockTensor('float32', nextState, [38256]),
        };
      },
    };

    const model = createDpdfnetModel({ Tensor: MockTensor }, session);
    expect(model.hop).toBe(160);
    const out = await model.process(
      Float32Array.from(golden.mixRe),
      Float32Array.from(golden.mixIm),
      T,
      model.createState()
    );

    expect(t).toBe(T);
    for (let i = 0; i < out.re.length; i++) {
      expect(Math.abs(out.re[i] - golden.enhRe[i])).toBeLessThan(1e-5);
      expect(Math.abs(out.im[i] - golden.enhIm[i])).toBeLessThan(1e-5);
    }
  });
});

describe('DPDFNet through real onnxruntime-web', () => {
  it('reproduces Python ORT golden reference outputs on 30 frames with state carry', async () => {
    let ort;
    try {
      ort = await import('onnxruntime-web');
    } catch {
      throw new Error('onnxruntime-web is not installed');
    }
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(new Uint8Array(modelBytes), { executionProviders: ['wasm'] });
    const model = createDpdfnetModel(ort, session);

    const out = await model.process(
      Float32Array.from(golden.mixRe),
      Float32Array.from(golden.mixIm),
      golden.T,
      model.createState()
    );

    let peak = 0, maxErr = 0;
    for (let i = 0; i < out.re.length; i++) {
      peak = Math.max(peak, Math.abs(golden.enhRe[i]), Math.abs(golden.enhIm[i]));
      maxErr = Math.max(maxErr, Math.abs(out.re[i] - golden.enhRe[i]), Math.abs(out.im[i] - golden.enhIm[i]));
    }
    // Relative error must be under 1e-3 (typically ~1e-5 between WASM and CPU native)
    expect(maxErr / (peak || 1)).toBeLessThan(1e-3);
  }, 120000);
});
