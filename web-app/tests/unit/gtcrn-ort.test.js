// REAL onnxruntime-web + the real model vs outputs produced by Python onnxruntime on the same frames.
// This is the key end-to-end check that the JS inference path is numerically right. It needs `npm install`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGtcrnModel } from '../../src/audio/gtcrn.js';

const golden = JSON.parse(readFileSync(new URL('../fixtures/gtcrn_golden.json', import.meta.url), 'utf8'));
const modelBytes = readFileSync(new URL('../../public/models/gtcrn_simple.onnx', import.meta.url));

describe('GTCRN through real onnxruntime-web', () => {
  it('reproduces the Python reference outputs on 30 frames (cache carry included)', async () => {
    let ort;
    try { ort = await import('onnxruntime-web'); } catch { throw new Error('onnxruntime-web is not installed: run `npm install` in web-app/ first.'); }
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(new Uint8Array(modelBytes), { executionProviders: ['wasm'] });
    const model = createGtcrnModel(ort, session);
    const out = await model.process(Float32Array.from(golden.mixRe), Float32Array.from(golden.mixIm), golden.T, model.createState());
    let peak = 0, maxErr = 0;
    for (let i = 0; i < out.re.length; i++) {
      peak = Math.max(peak, Math.abs(golden.enhRe[i]), Math.abs(golden.enhIm[i]));
      maxErr = Math.max(maxErr, Math.abs(out.re[i] - golden.enhRe[i]), Math.abs(out.im[i] - golden.enhIm[i]));
    }
    expect(maxErr / peak).toBeLessThan(1e-3);
  }, 120000);
});
