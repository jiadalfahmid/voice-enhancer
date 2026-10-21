import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VersionStore, MemoryBudgetError } from '../../src/studio/versions.ts';
import { JobCoordinator, pickConcurrency, AlignmentError } from '../../src/studio/coordinator.ts';
import { checkSecondPass, comparisonTargets } from '../../src/studio/rules.ts';
import { ENGINE_CATALOG, isRunnable } from '../../src/studio/engines.ts';
import type { AudioData, EngineAdapter } from '../../src/studio/types.ts';

const audio = (n = 100, v = 0.1): AudioData => ({ sampleRate: 16000, channels: [new Float32Array(n).fill(v)] });
const engine = (id: string, run?: EngineAdapter['run'], availability: 'browser-ready' | 'unsupported' = 'browser-ready'): EngineAdapter => ({
  info: { id, label: id, availability, runtime: 'wasm', sampleRate: 16000, license: 'MIT' },
  async load() {}, dispose() {},
  run: run ?? (async (a) => ({ sampleRate: a.sampleRate, channels: a.channels.map((c) => c.map((x) => x * 0.5)) })),
});
const setup = (engines: EngineAdapter[], max = 1, budget?: number) => {
  const store = new VersionStore(budget);
  const orig = store.setOriginal(audio());
  return { store, orig, co: new JobCoordinator(store, new Map(engines.map((e) => [e.info.id, e])), max) };
};

test('original is immutable and cannot be discarded or replaced', () => {
  const { store, orig } = setup([]);
  assert.throws(() => store.setOriginal(audio()));
  assert.throws(() => store.discard(orig.id));
});

test('a successful run adds a result and keeps the original', async () => {
  const { store, orig, co } = setup([engine('a')]);
  const id = await co.enqueue(orig.id, 'a').promise;
  assert.equal(store.get(id)!.parentId, orig.id);
  assert.equal(store.get(orig.id)!.audio!.channels[0][0], Math.fround(0.1));
});

test('a failed run is recorded and previous results survive', async () => {
  const { store, orig, co } = setup([engine('a'), engine('bad', async () => { throw new Error('boom'); })]);
  const ok = await co.enqueue(orig.id, 'a').promise;
  await assert.rejects(co.enqueue(orig.id, 'bad').promise, /boom/);
  assert.ok(store.get(ok)!.audio);
  assert.equal(store.list().filter((v) => v.status === 'failed').length, 1);
});

test('output with misaligned length is rejected', async () => {
  const { orig, co } = setup([engine('short', async (a) => ({ sampleRate: a.sampleRate, channels: [new Float32Array(50)] }))]);
  await assert.rejects(co.enqueue(orig.id, 'short').promise, AlignmentError);
});

test('non browser-ready engines refuse to run', async () => {
  const { orig, co } = setup([engine('x', undefined, 'unsupported')]);
  await assert.rejects(co.enqueue(orig.id, 'x').promise, /cannot run in the browser/);
});

test('cancel aborts a running job without storing a failure', async () => {
  const slow = engine('slow', (_a, ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(new DOMException('c', 'AbortError')))));
  const { store, orig, co } = setup([slow]);
  const h = co.enqueue(orig.id, 'slow');
  await new Promise((r) => setTimeout(r, 5));
  h.cancel();
  await assert.rejects(h.promise);
  assert.equal(h.state(), 'cancelled');
  assert.equal(store.list().length, 1);
});

test('concurrency limit queues the second job', async () => {
  let active = 0, peak = 0;
  const track = engine('t', async (a) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 10)); active--; return a; });
  const { orig, co } = setup([track], 1);
  await Promise.all([co.enqueue(orig.id, 't').promise, co.enqueue(orig.id, 't').promise]);
  assert.equal(peak, 1);
  assert.equal(pickConcurrency(4, 8), 1);
  assert.equal(pickConcurrency(8, 8), 2);
});

test('memory budget refuses the add instead of evicting', async () => {
  const { orig, co } = setup([engine('a')], 1, 100 * 4 + 10);
  await assert.rejects(co.enqueue(orig.id, 'a').promise, MemoryBudgetError);
});

test('second pass: explicit only, warns on distortion and same-model repeat', async () => {
  const { store, orig, co } = setup([engine('a'), engine('b')]);
  const r1 = await co.enqueue(orig.id, 'a').promise;
  assert.equal(checkSecondPass(store, r1, 'b', { userRequested: false }).allowed, false);
  const same = checkSecondPass(store, r1, 'a', { userRequested: true });
  assert.equal(same.allowed, true); assert.equal(same.warnings.length, 2);
  assert.equal(checkSecondPass(store, r1, 'b', { userRequested: true }).warnings.length, 1);
});

test('stage 2 compares against stage 1 and the original; discard removes descendants', async () => {
  const { store, orig, co } = setup([engine('a'), engine('b')]);
  const r1 = await co.enqueue(orig.id, 'a').promise;
  const r2 = await co.enqueue(r1, 'b').promise;
  assert.deepEqual(comparisonTargets(store, r2), [orig.id, r1, r2]);
  store.discard(r1);
  assert.equal(store.get(r2), null);
});

test('catalog is honest: only browser-ready engines are runnable', () => {
  assert.deepEqual(ENGINE_CATALOG.filter(isRunnable).map((e) => e.id), ['gtcrn', 'deepfilternet3', 'dpdfnet-16k', 'dpdfnet-48k']);
});

test('memory pre-flight fails before any processing starts', async () => {
  let ran = false;
  const { store, orig, co } = setup([engine('a', async (a) => { ran = true; return a; })], 1, 100 * 4 + 10);
  await assert.rejects(co.enqueue(orig.id, 'a').promise, MemoryBudgetError);
  assert.equal(ran, false);
  assert.equal(store.list().filter((v) => v.status === 'failed').length, 1);
});

test('imported results keep their label', () => {
  const { store, orig } = setup([]);
  const v = store.addResult(orig.id, 'external', audio(), 0, 'Imported: x.wav');
  assert.equal(store.get(v.id)!.label, 'Imported: x.wav');
});

test('idle engine disposal keeps only the most recent engine warm across runs', async () => {
  const disposed: string[] = [];
  const makeEngine = (id: string): EngineAdapter => ({
    info: { id, label: id, availability: 'browser-ready', runtime: 'wasm', sampleRate: 16000, license: 'MIT' },
    async load() {},
    dispose() { disposed.push(id); },
    run: async (a) => a,
  });

  const engines = [makeEngine('e1'), makeEngine('e2'), makeEngine('e3'), makeEngine('e4')];
  const { orig, co } = setup(engines, 1);

  await co.enqueue(orig.id, 'e1').promise;
  assert.deepEqual(disposed, [], 'first engine remains warm');

  await co.enqueue(orig.id, 'e2').promise;
  assert.ok(disposed.includes('e1'), 'e1 was disposed after e2 completed');

  await co.enqueue(orig.id, 'e3').promise;
  assert.ok(disposed.includes('e2'), 'e2 was disposed after e3 completed');

  await co.enqueue(orig.id, 'e4').promise;
  assert.ok(disposed.includes('e3'), 'e3 was disposed after e4 completed');

  // Verify only the most recent engine ('e4') was never disposed
  assert.equal(disposed.includes('e4'), false, 'e4 is kept warm');
});

