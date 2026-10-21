import { describe, it, expect } from 'vitest';
import { createFileWorkerCore } from '../../src/workers/file-worker-core.js';
import { DF3_MODEL_RATE, DF3_FRAME_LENGTH } from '../../src/audio/pipeline-df3.js';

// Mock model that implements the DeepFilterNet3 contract
function createMockDf3Model() {
  return {
    id: 'deepfilternet3',
    label: 'DeepFilterNet3 (Mock)',
    sampleRate: DF3_MODEL_RATE,
    frameLength: DF3_FRAME_LENGTH,
    createState(attenLim = 100) {
      let freed = false;
      return {
        frameLength: DF3_FRAME_LENGTH,
        processFrame(input) {
          if (freed) throw new Error('freed');
          // Mock noise attenuation (0.85x scale)
          const out = new Float32Array(input.length);
          for (let i = 0; i < input.length; i++) {
            out[i] = input[i] * 0.85;
          }
          return out;
        },
        setAttenLim() {},
        free() {
          freed = true;
        },
      };
    },
  };
}

const mockLoader = async (id) => {
  if (id === 'deepfilternet3') return createMockDf3Model();
  throw new Error(`Unknown model: ${id}`);
};

const sine = (n, rate, f = 440, a = 0.3) =>
  Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / rate));

describe('DeepFilterNet3 through file worker core', () => {
  it('processes, renders and previews mono 48 kHz audio keeping exact length and rate', async () => {
    const msgs = [];
    const core = createFileWorkerCore((m) => msgs.push(m), { loadModel: mockLoader });

    const sampleRate = 48000;
    const n = sampleRate * 2; // 2 seconds
    const channels = [sine(n, sampleRate)];

    await core.handle({
      id: 1,
      type: 'process',
      channels,
      sampleRate,
      options: { modelId: 'deepfilternet3' },
    });

    const doneMsg = msgs.find((m) => m.type === 'done');
    expect(doneMsg).toBeDefined();
    expect(doneMsg.id).toBe(1);
    expect(doneMsg.sampleRate).toBe(sampleRate);
    expect(doneMsg.length).toBe(n);
    expect(doneMsg.durationSec).toBe(2);

    // Progress reported
    const progressMsgs = msgs.filter((m) => m.type === 'progress');
    expect(progressMsgs.length).toBeGreaterThan(0);
    expect(progressMsgs.at(-1).value).toBe(1);

    // Test render
    msgs.length = 0;
    core.handle({ id: 2, type: 'render', options: { strength: 1 } });
    const renderedMsg = msgs.find((m) => m.type === 'rendered');
    expect(renderedMsg).toBeDefined();
    expect(renderedMsg.channels[0].length).toBe(n);

    // Test previewAB
    msgs.length = 0;
    core.handle({ id: 3, type: 'previewAB', options: { strength: 1 }, window: { startSec: 0, lengthSec: 1 } });
    const abMsg = msgs.find((m) => m.type === 'previewedAB');
    expect(abMsg).toBeDefined();
    expect(abMsg.a[0].length).toBe(sampleRate);
    expect(abMsg.b[0].length).toBe(sampleRate);
  });

  it('resamples non-48 kHz audio to 48 kHz and back preserving exact original length', async () => {
    const msgs = [];
    const core = createFileWorkerCore((m) => msgs.push(m), { loadModel: mockLoader });

    const sampleRate = 16000;
    const n = sampleRate * 1.5; // 1.5 seconds at 16 kHz
    const channels = [sine(n, sampleRate, 300, 0.2), sine(n, sampleRate, 600, 0.4)];

    await core.handle({
      id: 10,
      type: 'process',
      channels,
      sampleRate,
      options: { modelId: 'deepfilternet3' },
    });

    const doneMsg = msgs.find((m) => m.type === 'done');
    expect(doneMsg).toBeDefined();
    expect(doneMsg.length).toBe(n);
    expect(doneMsg.sampleRate).toBe(sampleRate);

    msgs.length = 0;
    core.handle({ id: 11, type: 'render', options: { strength: 1 } });
    const renderedMsg = msgs.find((m) => m.type === 'rendered');
    expect(renderedMsg).toBeDefined();
    expect(renderedMsg.channels.length).toBe(2);
    expect(renderedMsg.channels[0].length).toBe(n);
    expect(renderedMsg.channels[1].length).toBe(n);
  });

  it('handles cancellation gracefully', async () => {
    const msgs = [];
    const slowModel = {
      ...createMockDf3Model(),
      createState() {
        return {
          frameLength: DF3_FRAME_LENGTH,
          processFrame(input) { return new Float32Array(input.length); },
          setAttenLim() {},
          free() {},
        };
      },
    };

    const core = createFileWorkerCore((m) => msgs.push(m), {
      loadModel: async () => slowModel,
    });

    const sampleRate = 48000;
    const n = sampleRate * 5; // 5 seconds
    const channels = [sine(n, sampleRate)];

    const processPromise = core.handle({
      id: 20,
      type: 'process',
      channels,
      sampleRate,
      options: { modelId: 'deepfilternet3' },
    });

    // Cancel after short delay
    await new Promise((r) => setTimeout(r, 10));
    core.handle({ type: 'cancel' });

    await processPromise;

    const cancelledMsg = msgs.find((m) => m.type === 'cancelled');
    expect(cancelledMsg).toBeDefined();
  });
});
