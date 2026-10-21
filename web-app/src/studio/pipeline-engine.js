// Wraps the existing file pipeline (worker + enhanceFile) as a studio EngineAdapter.
// `job` is a createFileJob()-style object; it is injected so this file is testable without a browser.
import { DEPTH_LEVELS, ECHO_LEVELS } from '../audio/postprocess.js';
import { STUDIO_TARGET_LUFS } from './audioTools.js';

export const NATURAL_OPTIONS = { hpf: { enabled: true, fc: 80 }, depth: DEPTH_LEVELS.standard, rt60: ECHO_LEVELS.off, clarity: false, mono: false };

const abortError = () => new DOMException('cancelled', 'AbortError');

export function createPipelineEngine({ info, modelId, job, options = NATURAL_OPTIONS }) {
  return {
    info,
    async load() { /* the model is loaded inside the worker on first run */ },
    async run(input, { signal, onProgress }) {
      if (signal.aborted) throw abortError();
      // the worker takes ownership of the buffers it is sent, so it gets copies: the stored version stays intact
      const channels = input.channels.map((c) => c.slice());
      const onAbort = () => job.cancel();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        await job.process({ channels, sampleRate: input.sampleRate, options: { modelId, ...options } }, { onProgress });
        if (signal.aborted) throw abortError();
        const r = await job.render({ strength: 1, targetLufs: STUDIO_TARGET_LUFS, normalize: true, useLimiter: true });
        return { channels: r.channels, sampleRate: input.sampleRate };
      } catch (e) {
        if (e && e.cancelled) throw abortError();
        throw e;
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
    dispose() { job.dispose(); },
  };
}
