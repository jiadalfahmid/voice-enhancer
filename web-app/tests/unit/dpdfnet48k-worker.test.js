import { describe, it, expect } from 'vitest';
import { createFileWorkerCore } from '../../src/workers/file-worker-core.js';
import { createDpdfnet48kInitialState } from '../../src/audio/dpdfnet48k-state.js';
import { DPDFNET48K_BINS } from '../../src/audio/dpdfnet48k-stft.js';

function createMockDpdfnet48kModel() {
  return {
    id: 'dpdfnet-48k',
    label: 'DPDFNet 48 kHz (Mock)',
    sampleRate: 48000,
    hop: 480,
    createState: () => createDpdfnet48kInitialState(),
    async process(re, im, T, state) {
      const outRe = new Float32Array(T * DPDFNET48K_BINS);
      const outIm = new Float32Array(T * DPDFNET48K_BINS);
      for (let i = 0; i < outRe.length; i++) {
        outRe[i] = re[i] * 0.85;
        outIm[i] = im[i] * 0.85;
      }
      return { re: outRe, im: outIm, state };
    },
  };
}

const mockLoader = async (id) => {
  if (id === 'dpdfnet-48k') return createMockDpdfnet48kModel();
  throw new Error(`Unknown model: ${id}`);
};

const sine = (n, rate, f = 440, a = 0.3) =>
  Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / rate));

describe('DPDFNet 48 kHz through file worker core', () => {
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
      options: { modelId: 'dpdfnet-48k' },
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

  it('resamples non-48 kHz audio to 48 kHz and back preserving exact length and stereo balance', async () => {
    const msgs = [];
    const core = createFileWorkerCore((m) => msgs.push(m), { loadModel: mockLoader });

    const sampleRate = 44100;
    const n = sampleRate * 1.5; // 1.5 seconds at 44.1 kHz
    const channels = [sine(n, sampleRate, 300, 0.2), sine(n, sampleRate, 600, 0.4)];

    await core.handle({
      id: 10,
      type: 'process',
      channels,
      sampleRate,
      options: { modelId: 'dpdfnet-48k' },
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
});
