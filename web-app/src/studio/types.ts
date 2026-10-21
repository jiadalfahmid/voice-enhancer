// ClearVoice Studio core types. Pure TypeScript, no DOM or runtime deps, so every rule here is unit-testable in Node.
export type Availability = 'browser-ready' | 'local-offline' | 'unsupported';
export type Runtime = 'ort-web' | 'wasm' | 'offline' | 'none';

export interface EngineInfo {
  id: string;
  label: string;
  availability: Availability;
  runtime: Runtime;
  sampleRate: number; // native rate the model needs
  license: string; // code + weights; 'unverified' until checked
  approxSizeMB?: number;
  notes?: string;
}

export interface AudioData {
  channels: Float32Array[];
  sampleRate: number;
}

export interface RunContext {
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
  onStatus?: (status: string) => void;
}

/** Every model integration implements this; internals may differ. */
export interface EngineAdapter {
  info: EngineInfo;
  load(signal: AbortSignal): Promise<void>;
  run(input: AudioData, ctx: RunContext): Promise<AudioData>;
  dispose(): void;
}

export type VersionKind = 'original' | 'result';
export interface Version {
  id: string;
  kind: VersionKind;
  parentId: string | null; // null for the original
  engineId: string | null;
  label?: string; // display name for imported results
  status: 'ok' | 'failed';
  error?: string;
  sampleRate: number;
  length: number; // samples per channel
  processingMs: number;
  createdAt: number;
  audio: AudioData | null; // null for failed entries
}
