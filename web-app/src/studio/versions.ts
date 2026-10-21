import type { AudioData, Version } from './types.ts';

export class MemoryBudgetError extends Error {
  code = 'MEMORY_BUDGET';
  constructor() { super('Not enough memory to keep another result. Discard a result you do not need and try again.'); }
}

const bytes = (a: AudioData | null) => (a ? a.channels.reduce((n, c) => n + c.byteLength, 0) : 0);

/**
 * Immutable-original, append-only history. Failed runs are recorded but never remove earlier results.
 * Nothing is evicted silently: when the budget is hit the add is refused and the user decides what to discard.
 */
export class VersionStore {
  private items = new Map<string, Version>();
  private seq = 0;
  private maxBytes: number;
  constructor(maxBytes = 1.5 * 1024 ** 3) { this.maxBytes = maxBytes; }

  private id(p: string) { return `${p}${++this.seq}`; }
  canFit(extraBytes: number) { return this.usedBytes() + extraBytes <= this.maxBytes; }
  usedBytes() { let n = 0; for (const v of this.items.values()) n += bytes(v.audio); return n; }

  setOriginal(audio: AudioData): Version {
    if (this.originalId()) throw new Error('The original is immutable; start a new session instead.');
    const frozen: AudioData = { sampleRate: audio.sampleRate, channels: audio.channels };
    return this.insert({ id: this.id('o'), kind: 'original', parentId: null, engineId: null, status: 'ok', sampleRate: audio.sampleRate, length: audio.channels[0].length, processingMs: 0, createdAt: Date.now(), audio: frozen });
  }

  addResult(parentId: string, engineId: string, audio: AudioData, processingMs: number, label?: string): Version {
    this.must(parentId);
    return this.insert({ id: this.id('r'), kind: 'result', parentId, engineId, label, status: 'ok', sampleRate: audio.sampleRate, length: audio.channels[0].length, processingMs, createdAt: Date.now(), audio });
  }

  addFailure(parentId: string, engineId: string, error: string, processingMs: number): Version {
    this.must(parentId);
    return this.insert({ id: this.id('f'), kind: 'result', parentId, engineId, status: 'failed', error, sampleRate: 0, length: 0, processingMs, createdAt: Date.now(), audio: null });
  }

  private insert(v: Version): Version {
    if (this.usedBytes() + bytes(v.audio) > this.maxBytes) throw new MemoryBudgetError();
    this.items.set(v.id, v);
    return v;
  }

  private must(id: string): Version {
    const v = this.items.get(id);
    if (!v) throw new Error(`Unknown version: ${id}`);
    return v;
  }

  get(id: string) { return this.items.get(id) ?? null; }
  originalId() { for (const v of this.items.values()) if (v.kind === 'original') return v.id; return null; }
  list() { return [...this.items.values()]; }

  /** Original -> ... -> this version. */
  lineage(id: string): Version[] {
    const out: Version[] = [];
    for (let v: Version | null = this.must(id); v; v = v.parentId ? this.must(v.parentId) : null) out.unshift(v);
    return out;
  }

  /** Discard a result (and its descendants). The original can never be discarded. */
  discard(id: string) {
    const v = this.must(id);
    if (v.kind === 'original') throw new Error('The original cannot be discarded.');
    for (const c of this.list()) if (c.parentId === id) this.discard(c.id);
    this.items.delete(id);
  }
}
