import type { AudioData, EngineAdapter } from './types.ts';
import { MemoryBudgetError, type VersionStore } from './versions.ts';

export class AlignmentError extends Error {
  code = 'ALIGNMENT';
  constructor(a: number, b: number) { super(`Output length ${b} does not match input length ${a}. The result was discarded to keep timing aligned.`); }
}

/** Android phones get one model at a time; desktops with plenty of RAM get two. */
export function pickConcurrency(deviceMemoryGb = 4, cores = 4): number {
  return deviceMemoryGb >= 8 && cores >= 6 ? 2 : 1;
}

export interface JobHandle { promise: Promise<string>; cancel(): void; state(): 'queued' | 'running' | 'done' | 'failed' | 'cancelled' }
export interface JobEvents { onProgress?: (fraction: number) => void; onStatus?: (status: string) => void; }

export class JobCoordinator {
  private running = 0;
  private queue: Array<() => void> = [];
  private loaded = new Map<string, Promise<void>>();
  private store: VersionStore;
  private engines: Map<string, EngineAdapter>;
  private maxConcurrent: number;
  private alignmentTolerance: number;
  private maxWarmEngines: number;
  private activeJobs = new Set<string>();
  private recentEngines: string[] = [];
  private usedEngines = new Set<string>();

  constructor(
    store: VersionStore,
    engines: Map<string, EngineAdapter>,
    maxConcurrent = 1,
    alignmentTolerance = 2,
    maxWarmEngines = 1
  ) {
    this.store = store;
    this.engines = engines;
    this.maxConcurrent = maxConcurrent;
    this.alignmentTolerance = alignmentTolerance;
    this.maxWarmEngines = Math.max(1, maxWarmEngines);
  }

  /** Retain only the most recently used idle engines warm; dispose the rest to prevent memory buildup. */
  private retainWarm(recentEngineId: string) {
    this.recentEngines = [recentEngineId, ...this.recentEngines.filter((id) => id !== recentEngineId)];
    const warmLimit = Math.max(this.maxWarmEngines, this.maxConcurrent);
    const toKeep = new Set([...this.activeJobs, ...this.recentEngines.slice(0, warmLimit)]);
    for (const id of Array.from(this.usedEngines)) {
      if (!toKeep.has(id)) {
        const engine = this.engines.get(id);
        engine?.dispose();
        this.loaded.delete(id);
        this.usedEngines.delete(id);
      }
    }
  }

  /** Dispose all engine workers. */
  disposeAll() {
    for (const [id, engine] of this.engines) {
      engine.dispose();
      this.loaded.delete(id);
    }
    this.recentEngines = [];
    this.usedEngines.clear();
  }

  /** Process `parentId` with `engineId`. Resolves with the new version id; failures are stored and never touch existing results. */
  enqueue(parentId: string, engineId: string, events: JobEvents = {}): JobHandle {
    const ctrl = new AbortController();
    let st: ReturnType<JobHandle['state']> = 'queued';
    const promise = new Promise<string>((resolve, reject) => {
      const start = async () => {
        st = 'running'; this.running++;
        this.activeJobs.add(engineId);
        this.usedEngines.add(engineId);
        const t0 = Date.now();
        try {
          if (ctrl.signal.aborted) throw new DOMException('cancelled', 'AbortError');
          const parent = this.store.get(parentId);
          const engine = this.engines.get(engineId);
          if (!parent?.audio) throw new Error('Nothing to process.');
          if (!engine) throw new Error(`Unknown engine: ${engineId}`);
          if (engine.info.availability !== 'browser-ready') throw new Error(`${engine.info.label} cannot run in the browser (${engine.info.availability}).`);
          const need = parent.audio.channels.reduce((n, c) => n + c.byteLength, 0); // output is the same size as the input
          if (!this.store.canFit(need)) throw new MemoryBudgetError(); // fail before spending minutes of processing
          if (!this.loaded.has(engineId)) this.loaded.set(engineId, engine.load(ctrl.signal).catch((e) => { this.loaded.delete(engineId); throw e; }));
          await this.loaded.get(engineId);
          if (ctrl.signal.aborted) throw new DOMException('cancelled', 'AbortError');
          const out: AudioData = await engine.run(parent.audio, {
            signal: ctrl.signal,
            onProgress: (f) => events.onProgress?.(f),
            onStatus: (s) => events.onStatus?.(s),
          });
          if (ctrl.signal.aborted) throw new DOMException('cancelled', 'AbortError');
          if (Math.abs(out.channels[0].length - parent.length) > this.alignmentTolerance) throw new AlignmentError(parent.length, out.channels[0].length);
          const v = this.store.addResult(parentId, engineId, out, Date.now() - t0);
          st = 'done'; resolve(v.id);
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') { st = 'cancelled'; reject(e); }
          else {
            st = 'failed';
            try { this.store.addFailure(parentId, engineId, (e as Error).message, Date.now() - t0); } catch { /* parent gone: nothing to attach to */ }
            reject(e);
          }
        } finally {
          this.activeJobs.delete(engineId);
          this.retainWarm(engineId);
          this.running--;
          this.next();
        }
      };
      this.queue.push(start);
      this.next();
    });
    promise.catch(() => {}); // callers observe via handle.promise; avoids unhandled rejections for fire-and-forget use
    return { promise, state: () => st, cancel: () => { ctrl.abort(); } };
  }

  private next() {
    while (this.running < this.maxConcurrent && this.queue.length) this.queue.shift()!();
  }
}
