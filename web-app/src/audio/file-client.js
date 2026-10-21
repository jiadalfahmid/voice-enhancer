// Main-thread helpers: decode an uploaded file and talk to the file worker (F1, F2, F11).
export class UserError extends Error {
  constructor(message, code = 'ERROR') { super(message); this.code = code; }
}

const MAX_BYTES = 2 * 1024 * 1024 * 1024;

export async function decodeAudioFile(file) {
  if (file.size > MAX_BYTES) throw new UserError('This file is larger than 2 GB, which is the limit.', 'TOO_LARGE');
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new UserError('This browser cannot decode audio. Try a recent Chrome, Edge, Firefox or Safari.', 'UNSUPPORTED');
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const n = Math.min(2, buf.numberOfChannels); // mono/stereo only
    const channels = Array.from({ length: n }, (_, c) => buf.getChannelData(c).slice());
    return { channels, sampleRate: buf.sampleRate, duration: buf.duration };
  } catch {
    throw new UserError('Could not read this file. Try WAV, MP3, M4A, OGG or a video with an audio track.', 'DECODE_FAILED');
  } finally {
    ctx.close();
  }
}

const cancelledError = () => Object.assign(new Error('cancelled'), { cancelled: true });

export function createFileJob() {
  let worker = null;
  let nextId = 1;
  const pending = new Map(); // id -> {resolve, reject, onProgress, onStatus}
  let killTimer = null;
  let processId = null; // a running process job can be cancelled (hard kill after 400 ms)
  let exportId = null;  // a running export can only be soft-cancelled (killing the worker would lose the result)

  const failAll = (err) => { for (const p of pending.values()) p.reject(err); pending.clear(); };
  const spawn = () => {
    worker = new Worker(new URL('../workers/worker-file.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'cancelled') { clearTimeout(killTimer); processId = null; exportId = null; failAll(cancelledError()); return; }
      const p = pending.get(m.id);
      if (!p) return;
      if (m.id === processId && (m.type === 'done' || m.type === 'error')) processId = null;
      if (m.id === exportId && (m.type === 'exported' || m.type === 'error')) exportId = null;
      if (m.type === 'progress') p.onProgress && p.onProgress(m.value);
      else if (m.type === 'status') p.onStatus && p.onStatus(m.text);
      else if (m.type === 'error') { pending.delete(m.id); p.reject(new UserError(m.message, m.code)); }
      else { pending.delete(m.id); p.resolve(m); }
    };
    worker.onerror = () => failAll(new UserError('The processing engine crashed. Please try again.', 'WORKER_CRASHED'));
  };
  const request = (message, transfer = [], { onProgress, onStatus } = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress, onStatus });
    worker.postMessage({ ...message, id }, transfer);
  });

  return {
    process({ channels, sampleRate, options }, handlers) {
      if (!worker) spawn();
      processId = nextId; // id the next request() call will use
      return request({ type: 'process', channels, sampleRate, options }, channels.map((c) => c.buffer), handlers);
    },
    /** Original (loudness-matched) and enhanced versions of the same short window, for the A/B player. */
    previewAB(options, window) {
      if (!worker) return Promise.reject(new UserError('Nothing to preview yet.', 'NO_RESULT'));
      return request({ type: 'previewAB', options, window });
    },
    /** Full-length mixed + limited float channels (no encoding): used by the studio to store a result version. */
    render(options) {
      if (!worker) return Promise.reject(new UserError('Nothing to render yet.', 'NO_RESULT'));
      return request({ type: 'render', options });
    },
    /** Full-length render + encode for download. options.format: 'wav16' | 'wav24' | 'mp3' (+ kbps). */
    export(options, handlers) {
      if (!worker) return Promise.reject(new UserError('Nothing to export yet.', 'NO_RESULT'));
      exportId = nextId;
      return request({ type: 'export', options }, [], handlers);
    },
    /** Soft cancel; hard-terminates the worker if it has not acknowledged within 400 ms (F2: cancel < 500 ms). */
    cancel() {
      if (!worker) return;
      if (processId === null) { if (exportId !== null) worker.postMessage({ type: 'cancel' }); return; }
      worker.postMessage({ type: 'cancel' });
      killTimer = setTimeout(() => {
        worker.terminate(); worker = null; processId = null;
        failAll(cancelledError());
      }, 400);
    },
    dispose() { clearTimeout(killTimer); if (worker) worker.terminate(); worker = null; failAll(cancelledError()); },
  };
}
