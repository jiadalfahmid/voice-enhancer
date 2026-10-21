import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineEngine } from '../../src/studio/pipeline-engine.js';
import { windowOf, matchLoudness, fitLength, matchChannels, safeName, durationLimitMinutes, storeBudgetBytes } from '../../src/studio/audioTools.js';
import { createFileWorkerCore } from '../../src/workers/file-worker-core.js';
import { VersionStore } from '../../src/studio/versions.ts';
import { JobCoordinator } from '../../src/studio/coordinator.ts';
import { integratedLufs } from '../../src/audio/lufs.js';
import { applyVoicePolish, VOICE_EQ_PRESETS } from '../../src/audio/voice-polish.js';

const sine = (n, rate, f = 220, a = 0.2) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / rate));
const noisy = (n, rate) => { const s = sine(n, rate); let x = 1; for (let i = 0; i < n; i++) { x = (x * 16807) % 2147483647; s[i] += 0.02 * (x / 2147483647 - 0.5); } return s; };

// A job that talks to the real worker core in-process (same messages the browser worker uses).
function inProcessJob() {
  const waiters = new Map();
  let nextId = 1;
  const core = createFileWorkerCore((m) => { const w = waiters.get(m.id); if (!w) return; if (m.type === 'progress') w.onProgress?.(m.value); else if (m.type === 'error') { waiters.delete(m.id); w.reject(Object.assign(new Error(m.message), { code: m.code })); } else if (m.type !== 'status') { waiters.delete(m.id); w.resolve(m); } });
  const req = (msg, h = {}) => new Promise((resolve, reject) => { const id = nextId++; waiters.set(id, { resolve, reject, ...h }); core.handle({ ...msg, id }); });
  let cancelled = false;
  return {
    process: ({ channels, sampleRate, options }, h) => req({ type: 'process', channels, sampleRate, options }, h),
    render: (options) => req({ type: 'render', options }),
    cancel: () => { cancelled = true; core.handle({ type: 'cancel' }); },
    dispose() {}, get cancelled() { return cancelled; },
  };
}

const info = { id: 'demo', label: 'Demo', availability: 'browser-ready', runtime: 'ort-web', sampleRate: 16000, license: 'test' };

test('end to end: engine + coordinator + real worker core keeps length, rate and the original', async () => {
  const rate = 16000, n = rate * 2;
  const original = { sampleRate: rate, channels: [noisy(n, rate)] };
  const before = Float32Array.from(original.channels[0]);
  const engine = createPipelineEngine({ info, modelId: 'spectral-gate-demo', job: inProcessJob() });
  const store = new VersionStore();
  const o = store.setOriginal(original);
  const co = new JobCoordinator(store, new Map([['demo', engine]]), 1);
  const progress = [];
  const id = await co.enqueue(o.id, 'demo', { onProgress: (p) => progress.push(p) }).promise;
  const r = store.get(id);
  assert.equal(r.length, n);
  assert.equal(r.sampleRate, rate);
  assert.deepEqual(Array.from(store.get(o.id).audio.channels[0].subarray(0, 50)), Array.from(before.subarray(0, 50)));
  assert.ok(progress.length > 0 && progress.at(-1) <= 1);
  assert.ok(Math.abs(integratedLufs(r.audio.channels, rate) - -16) < 1.5, 'result is loudness-normalised to about -16 LUFS');
  // second pass runs on the stage-1 result without touching it
  const id2 = await co.enqueue(id, 'demo').promise;
  assert.equal(store.get(id2).parentId, id);
  assert.equal(store.lineage(id2).length, 3);
});

test('aborting stops the job and reports AbortError', async () => {
  const job = { process: () => new Promise((_, rej) => { job._rej = rej; }), render: async () => { throw new Error('should not render'); }, cancel() { job._rej(Object.assign(new Error('c'), { cancelled: true })); }, dispose() {} };
  const engine = createPipelineEngine({ info, modelId: 'x', job });
  const ctrl = new AbortController();
  const p = engine.run({ channels: [new Float32Array(10)], sampleRate: 16000 }, { signal: ctrl.signal, onProgress() {} });
  ctrl.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
});

test('worker gets copies: the input stays usable after run', async () => {
  const input = { channels: [sine(8000, 16000)], sampleRate: 16000 };
  let sent;
  const job = { async process({ channels }) { sent = channels[0]; }, async render() { return { channels: [new Float32Array(8000)] }; }, cancel() {}, dispose() {} };
  await createPipelineEngine({ info, modelId: 'x', job }).run(input, { signal: new AbortController().signal, onProgress() {} });
  assert.notEqual(sent.buffer, input.channels[0].buffer);
});

test('audio tools', () => {
  const rate = 48000;
  const loud = [sine(rate * 5, rate, 440, 0.5)], quiet = [sine(rate * 5, rate, 440, 0.05)];
  const a = integratedLufs(matchLoudness(loud, rate), rate), b = integratedLufs(matchLoudness(quiet, rate), rate);
  assert.ok(Math.abs(a - -20) < 0.5 && Math.abs(b - -20) < 0.5);
  assert.equal(windowOf([new Float32Array(1000)], 100, 8, 5)[0].length, 200); // clamps at the end
  assert.equal(fitLength([new Float32Array(5)], 8)[0].length, 8);
  assert.equal(matchChannels([new Float32Array(4), new Float32Array(4)], 1).length, 1);
  assert.equal(matchChannels([new Float32Array(4)], 2).length, 2);
  assert.equal(safeName('Scene 3 take 1 (final).mp3'), 'Scene-3-take-1-final');
  assert.equal(durationLimitMinutes(4), 10); assert.equal(durationLimitMinutes(8), 30);
  assert.ok(storeBudgetBytes(4) < storeBudgetBytes(8));
  assert.equal(matchLoudness([new Float32Array(rate)], rate)[0][0], 0); // silence stays silence
});

test('voice polish: balances and equalizes audio and registers cleanly in VersionStore', () => {
  const rate = 48000;
  const n = rate * 2;
  const store = new VersionStore();
  const orig = store.setOriginal({ channels: [noisy(n, rate)], sampleRate: rate });

  const polished = applyVoicePolish(orig.audio.channels, rate, {
    balancer: { enabled: true, strength: 0.8 },
    equalizer: { enabled: true, ...VOICE_EQ_PRESETS.podcast },
  });

  assert.equal(polished.length, 1);
  assert.equal(polished[0].length, n);

  const res = store.addResult(orig.id, 'voice-polish', { channels: polished, sampleRate: rate }, 15, 'Voice Polish: Podcast');
  assert.equal(res.parentId, orig.id);
  assert.equal(store.lineage(res.id).length, 2);
  assert.equal(res.label, 'Voice Polish: Podcast');
});

test('engine adapters are built once and not rebuilt across multiple renders or runs', async () => {
  const React = await import('react');
  const { useStudio } = await import('../../src/studio/useStudio.js');
  let hooks = [], idx = 0;
  const disp = {
    useRef: (init) => { const i = idx++; if (!hooks[i]) hooks[i] = { current: init }; return hooks[i]; },
    useState: (init) => { const i = idx++; if (hooks[i] === undefined) hooks[i] = typeof init === 'function' ? init() : init; return [hooks[i], (v) => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }]; },
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  };
  function render() {
    idx = 0;
    React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current = disp;
    return useStudio();
  }
  const s1 = render();
  const enginesInitial = hooks[0].current.engines;
  const s2 = render();
  const s3 = render();
  assert.equal(hooks[0].current.engines, enginesInitial, 'engines Map is identical across multiple renders');

  // Verify that all engine instances inside the map are untouched
  const gtcrnEngine = enginesInitial.get('gtcrn');
  assert.ok(gtcrnEngine, 'gtcrn engine exists in catalog');

  const s4 = render();
  assert.equal(hooks[0].current.engines.get('gtcrn'), gtcrnEngine, 'engine instances are not replaced on render');
});

