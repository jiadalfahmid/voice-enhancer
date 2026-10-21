import { describe, it, expect } from 'vitest';
import { createFileWorkerCore } from '../../src/workers/file-worker-core.js';
import { UnknownModelError } from '../../src/audio/models.js';

const tone = (fs, sec) => Float32Array.from({ length: fs * sec }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 300 * i) / fs));
const last = (a) => a[a.length - 1];

describe('file worker core', () => {
  it('process, preview and export return channels and loudness stats, echoing ids', async () => {
    const msgs = [];
    const core = createFileWorkerCore((m) => msgs.push(m));
    await core.handle({ id: 1, type: 'process', channels: [tone(16000, 4)], sampleRate: 16000, options: { modelId: 'passthrough', chunkSeconds: 2 } });
    expect(msgs.some((m) => m.type === 'progress' && m.id === 1)).toBe(true);
    expect(last(msgs).type).toBe('done');
    expect(last(msgs).durationSec).toBe(4);
    core.handle({ id: 2, type: 'preview', options: { strength: 1, targetLufs: -16 }, window: { startSec: 1, lengthSec: 2 } });
    expect(last(msgs).type).toBe('previewed');
    expect(last(msgs).id).toBe(2);
    expect(last(msgs).channels[0].length).toBe(32000);
    await core.handle({ id: 3, type: 'export', options: { strength: 1, targetLufs: -16, format: 'wav16' } });
    const ex = last(msgs);
    expect(ex.type).toBe('exported');
    expect(ex.ext).toBe('wav');
    expect(ex.parts.reduce((n, p) => n + p.length, 0)).toBe(44 + 16000 * 4 * 2);
    expect(Math.abs(ex.stats.lufs + 16)).toBeLessThan(0.5);
  });
  it('a missing or unknown modelId is an error, never a silent fallback', async () => {
    const a = [], b = [];
    await createFileWorkerCore((m) => a.push(m)).handle({ id: 1, type: 'process', channels: [tone(16000, 1)], sampleRate: 16000, options: {} });
    expect(last(a).type).toBe('error');
    expect(last(a).code).toBe('UNKNOWN_MODEL');
    await createFileWorkerCore((m) => b.push(m)).handle({ id: 1, type: 'process', channels: [tone(16000, 1)], sampleRate: 16000, options: { modelId: 'nope' } });
    expect(last(b).code).toBe('UNKNOWN_MODEL');
  });
  it('a failing model download is reported as MODEL_LOAD_FAILED', async () => {
    const msgs = [];
    const core = createFileWorkerCore((m) => msgs.push(m), { loadModel: async () => { throw new Error('404'); } });
    await core.handle({ id: 1, type: 'process', channels: [tone(16000, 1)], sampleRate: 16000, options: { modelId: 'gtcrn' } });
    expect(last(msgs).code).toBe('MODEL_LOAD_FAILED');
  });
  it('cancel yields a cancelled message', async () => {
    const msgs = [];
    const core = createFileWorkerCore((m) => { msgs.push(m); if (m.type === 'progress' && m.value > 0.1) core.handle({ type: 'cancel' }); });
    await core.handle({ id: 1, type: 'process', channels: [tone(16000, 20)], sampleRate: 16000, options: { modelId: 'passthrough', chunkSeconds: 2 } });
    expect(last(msgs).type).toBe('cancelled');
  });
  it('export before process gives a readable error', async () => {
    const msgs = [];
    await createFileWorkerCore((m) => msgs.push(m)).handle({ id: 9, type: 'export', options: {} });
    expect(msgs[0].type).toBe('error');
    expect(msgs[0].message.length > 10).toBe(true);
  });
  it('UnknownModelError carries the UNKNOWN_MODEL code', () => expect(new UnknownModelError('x').code).toBe('UNKNOWN_MODEL'));
});

describe('A/B preview and MP3 export in the worker core', () => {
  async function ready(extra = {}) {
    const msgs = [];
    const core = createFileWorkerCore((m) => msgs.push(m), extra);
    await core.handle({ id: 1, type: 'process', channels: [tone(16000, 4)], sampleRate: 16000, options: { modelId: 'passthrough', chunkSeconds: 2 } });
    return { core, msgs };
  }
  it('previewAB returns same-length original and enhanced windows, loudness matched', async () => {
    const { core, msgs } = await ready();
    core.handle({ id: 2, type: 'previewAB', options: { strength: 1, targetLufs: -16 }, window: { startSec: 0, lengthSec: 3 } });
    const m = last(msgs);
    expect(m.type).toBe('previewedAB');
    expect(m.a[0].length).toBe(m.b[0].length);
    expect(m.a[0].length).toBe(48000);
    expect(m.stats.startSec).toBe(0);
  });
  it('mp3 export uses the injected encoder, reports progress and returns audio/mpeg parts', async () => {
    const calls = [];
    class FakeEnc {
      constructor(ch, fs, kbps) { calls.push(['new', ch, fs, kbps]); }
      encodeBuffer(l, r) { calls.push(['enc', l.length, r ? r.length : 0]); return new Int8Array([1, 2, 3]); }
      flush() { calls.push(['flush']); return new Int8Array([9]); }
    }
    const { core, msgs } = await ready({ loadMp3: async () => FakeEnc });
    await core.handle({ id: 3, type: 'export', options: { strength: 1, targetLufs: -16, format: 'mp3', kbps: 192 } });
    const ex = last(msgs);
    expect(ex.type).toBe('exported');
    expect(ex.mime).toBe('audio/mpeg');
    expect(calls[0]).toEqual(['new', 1, 16000, 192]);
    expect(calls.some((c) => c[0] === 'flush')).toBe(true);
    expect(ex.parts.length > 1).toBe(true);
  });
  it('mp3 export without an encoder is a readable MP3_UNAVAILABLE error', async () => {
    const { core, msgs } = await ready();
    await core.handle({ id: 3, type: 'export', options: { format: 'mp3', kbps: 192 } });
    expect(last(msgs).code).toBe('MP3_UNAVAILABLE');
  });
});
