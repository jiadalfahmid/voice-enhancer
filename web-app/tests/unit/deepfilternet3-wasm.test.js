import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeepfilternet3Model } from '../../src/audio/deepfilternet3.js';
import { DF3_MODEL_RATE, DF3_FRAME_LENGTH } from '../../src/audio/pipeline-df3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, '../../public/models/deepfilternet3/df_bg.wasm');
const modelPath = path.resolve(__dirname, '../../public/models/deepfilternet3/DeepFilterNet3_onnx.tar.gz');

describe('DeepFilterNet3 WASM Adapter', () => {
  it('instantiates the WASM module and processes 48 kHz frames', async () => {
    expect(fs.existsSync(wasmPath)).toBe(true);
    expect(fs.existsSync(modelPath)).toBe(true);

    const wasmBytes = fs.readFileSync(wasmPath);
    const modelBytes = fs.readFileSync(modelPath);

    const model = await createDeepfilternet3Model(wasmBytes, modelBytes);
    expect(model.id).toBe('deepfilternet3');
    expect(model.sampleRate).toBe(DF3_MODEL_RATE);
    expect(model.frameLength).toBe(DF3_FRAME_LENGTH);

    const state = model.createState(100);
    expect(state.frameLength).toBe(480);

    const frameIn = new Float32Array(DF3_FRAME_LENGTH);
    for (let i = 0; i < DF3_FRAME_LENGTH; i++) {
      frameIn[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    }

    const frameOut = state.processFrame(frameIn);
    expect(frameOut).toBeInstanceOf(Float32Array);
    expect(frameOut.length).toBe(DF3_FRAME_LENGTH);

    // Verify non-NaN values
    for (let i = 0; i < frameOut.length; i++) {
      expect(Number.isFinite(frameOut[i])).toBe(true);
    }

    state.free();

    // Verify error thrown after free
    expect(() => state.processFrame(frameIn)).toThrow();
  });
});
