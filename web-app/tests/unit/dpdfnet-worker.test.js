import { describe, it, expect } from 'vitest';
import { createFileWorkerCore } from '../../src/workers/file-worker-core.js';
import { createDpdfnetInitialState } from '../../src/audio/dpdfnet-state.js';
import { DPDFNET_BINS } from '../../src/audio/dpdfnet-stft.js';

// Mock model that implements the DPDFNet contract
function createMockDpdfnetModel() {
  return {
    id: 'dpdfnet-16k',
    label: 'DPDFNet 16 kHz (Mock)',
    hop: 160,
    createState: () => createDpdfnetInitialState(),
    async process(re, im, T, state) {
      // Mock noise attenuation (0.8x scale)
      const outRe = new Float32Array(T * DPDFNET_BINS);
      const outIm = new Float32Array(T * DPDFNET_BINS);
      for (let i = 0; i < outRe.length; i++) {
        outRe[i] = re[i] * 0.8;
        outIm[i] = im[i] * 0.8;
      }
      return { re: outRe, im: outIm, state };
    },
  };
}

const mockLoader = async (id) => {
  if (id === 'dpdfnet-16k') return createMockDpdfnetModel();
  throw new Error(`Unknown model: ${id}`);
};

const sine = (n, rate, f = 440, a = 0.3) =>
  Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / rate));

describe('DPDFNet through file worker core', () => {
  it('processes, renders and previews mono audio keeping exact length and rate', async () => {
    const msgs = [];
    const core = createFileWorkerCore((m) => msgs.push(m), { loadModel: mockLoader });

    const sampleRate = 16000;
    const n = sampleRate * 2; // 2 seconds
    const channels = [sine(n, sampleRate)];

    await core.handle({
      id: 1,
      type: 'process',
      channels,
      sampleRate,
      options: { modelId: 'dpdfnet-16k' },
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
    expect(abMsg.a[0].length).toBe(sampleRate); // 1 sec window
    expect(abMsg.b[0].length).toBe(sampleRate);
  });

  it('handles stereo audio and preserves both channels', async () => {
    const msgs = [];
    const core = createFileWorkerCore((m) => msgs.push(m), { loadModel: mockLoader });

    const sampleRate = 44100; // non-16k rate test
    const n = sampleRate; // 1 second
    const channels = [sine(n, sampleRate, 300, 0.2), sine(n, sampleRate, 600, 0.4)];

    await core.handle({
      id: 10,
      type: 'process',
      channels,
      sampleRate,
      options: { modelId: 'dpdfnet-16k' },
    });

    const doneMsg = msgs.find((m) => m.type === 'done');
    expect(doneMsg).toBeDefined();
    expect(doneMsg.length).toBe(n);

    msgs.length = 0;
    core.handle({ id: 11, type: 'render', options: { strength: 1 } });
    const renderedMsg = msgs.find((m) => m.type === 'rendered');
    expect(renderedMsg.channels.length).toBe(2);
    expect(renderedMsg.channels[0].length).toBe(n);
    expect(renderedMsg.channels[1].length).toBe(n);
  });

  it('cancellation aborts processing cleanly', async () => {
    const msgs = [];
    const core = createFileWorkerCore((m) => msgs.push(m), { loadModel: mockLoader });

    const sampleRate = 16000;
    const channels = [sine(sampleRate * 5, sampleRate)];

    // Send process then immediately cancel
    const p = core.handle({
      id: 20,
      type: 'process',
      channels,
      sampleRate,
      options: { modelId: 'dpdfnet-16k' },
    });
    core.handle({ type: 'cancel' });
    await p;

    const cancelMsg = msgs.find((m) => m.type === 'cancelled');
    expect(cancelMsg).toBeDefined();
    expect(cancelMsg.id).toBe(20);
  });
});
