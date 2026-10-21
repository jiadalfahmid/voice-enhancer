// Message handling for the file worker, separated from `self` so it can be unit-tested in Node.
// main -> worker: {id, type:'process', channels, sampleRate, options:{modelId, hpf?, chunkSeconds?}}
//                 {id, type:'preview', options, window:{startSec, lengthSec}} | {id, type:'export', options} | {type:'cancel'}
// worker -> main (all echo `id`): {type:'status', text} {type:'progress', value} {type:'done', ...}
//                 {type:'previewed'|'exported', channels, stats} {type:'cancelled'} {type:'error', code, message}
import { enhanceFile, renderOutput, renderWindow, CancelledError } from '../audio/pipeline.js';
import { enhanceFileDpdfnet } from '../audio/pipeline-dpdfnet.js';
import { enhanceFileDpdfnet48k } from '../audio/pipeline-dpdfnet48k.js';
import { enhanceFileDf3 } from '../audio/pipeline-df3.js';
import { builtinLoader } from '../audio/models.js';
import { encodeWavParts } from '../audio/encode-wav.js';
import { encodeMp3 } from '../audio/encode-mp3.js';

export function createFileWorkerCore(post, { loadModel = builtinLoader, loadMp3 = null } = {}) {
  let cancelled = false;
  let cache = null;

  async function process(msg) {
    const send = (m, t) => post({ ...m, id: msg.id }, t);
    cancelled = false; cache = null;
    const { channels, sampleRate, options = {} } = msg;
    let model;
    try {
      if (!options.modelId) { send({ type: 'error', code: 'UNKNOWN_MODEL', message: 'No enhancement engine was selected.' }); return; }
      send({ type: 'status', text: 'Loading enhancement model...' });
      try {
        model = await loadModel(options.modelId, { onStatus: (text) => send({ type: 'status', text }) });
      } catch (err) {
        if (err && err.code === 'UNKNOWN_MODEL') send({ type: 'error', code: 'UNKNOWN_MODEL', message: 'That enhancement engine is not available.' });
        else send({ type: 'error', code: 'MODEL_LOAD_FAILED', message: 'The enhancement model could not be loaded. Reload the page and try again.', detail: String(err && err.message) });
        return;
      }
      if (cancelled) throw new CancelledError();
      send({ type: 'status', text: 'Enhancing...' });
      const enhanceFn = (options.modelId === 'dpdfnet-16k' || (model && model.id === 'dpdfnet-16k'))
        ? enhanceFileDpdfnet
        : (options.modelId === 'dpdfnet-48k' || (model && model.id === 'dpdfnet-48k'))
          ? enhanceFileDpdfnet48k
          : (options.modelId === 'deepfilternet3' || (model && model.id === 'deepfilternet3'))
            ? enhanceFileDf3
            : enhanceFile;
      cache = await enhanceFn({
        channels, sampleRate, model, hpf: options.hpf, chunkSeconds: options.chunkSeconds,
        depth: options.depth, rt60: options.rt60, clarity: options.clarity, mono: options.mono,
        onProgress: (value) => send({ type: 'progress', value }),
        onStatus: (text) => send({ type: 'status', text }),
        isCancelled: () => cancelled,
      });
      send({ type: 'done', sampleRate, length: channels[0].length, durationSec: channels[0].length / sampleRate, modelLabel: model.label });
    } catch (err) {
      if (err instanceof CancelledError) send({ type: 'cancelled' });
      else send({ type: 'error', code: 'PROCESS_FAILED', message: 'Processing failed. Try a shorter file or reload the page.', detail: String(err && (err.stack || err.message)) });
    }
  }

  function render(msg, fn, doneType) {
    const send = (m, t) => post({ ...m, id: msg.id }, t);
    if (!cache) return send({ type: 'error', code: 'NO_RESULT', message: 'Nothing to export yet. Process a file first.' });
    try {
      const { channels, ...stats } = fn(cache, msg.options || {}, msg.window || {});
      send({ type: doneType, channels, stats }, channels.map((c) => c.buffer));
    } catch (err) {
      send({ type: 'error', code: 'RENDER_FAILED', message: 'Could not render the result. Please try again.', detail: String(err && err.message) });
    }
  }

  /** A/B: same window at strength 0 (original, loudness-matched) and at the chosen strength. */
  function previewAB(msg) {
    const send = (m, t) => post({ ...m, id: msg.id }, t);
    if (!cache) return send({ type: 'error', code: 'NO_RESULT', message: 'Nothing to preview yet. Process a file first.' });
    try {
      const opts = msg.options || {}, win = msg.window || {};
      const a = renderWindow(cache, { ...opts, strength: 0 }, win);
      const b = renderWindow(cache, opts, win);
      const { channels: ac, ...aStats } = a;
      const { channels: bc, ...bStats } = b;
      send({ type: 'previewedAB', a: ac, b: bc, stats: bStats, originalStats: aStats }, [...ac, ...bc].map((c) => c.buffer));
    } catch (err) {
      send({ type: 'error', code: 'RENDER_FAILED', message: 'Could not render the preview. Please try again.', detail: String(err && err.message) });
    }
  }

  async function exportFile(msg) {
    const send = (m, t) => post({ ...m, id: msg.id }, t);
    if (!cache) return send({ type: 'error', code: 'NO_RESULT', message: 'Nothing to export yet. Process a file first.' });
    cancelled = false;
    const opts = msg.options || {};
    const format = opts.format || 'wav16';
    try {
      send({ type: 'status', text: 'Mixing and limiting...' });
      await new Promise((r) => setTimeout(r, 0));
      if (cancelled) throw new CancelledError();
      const { channels, ...stats } = renderOutput(cache, opts);
      send({ type: 'status', text: 'Encoding...' });
      let parts, mime, ext;
      if (format === 'mp3') {
        let Mp3Encoder = null;
        try { Mp3Encoder = loadMp3 ? await loadMp3() : null; } catch { Mp3Encoder = null; }
        if (!Mp3Encoder) { send({ type: 'error', code: 'MP3_UNAVAILABLE', message: 'MP3 export is not available in this build. Download a WAV instead.' }); return; }
        parts = await encodeMp3(channels, cache.sampleRate, opts.kbps || 192, {
          Mp3Encoder, onProgress: (value) => send({ type: 'progress', value }), check: () => { if (cancelled) throw new CancelledError(); },
        });
        mime = 'audio/mpeg'; ext = 'mp3';
      } else {
        parts = encodeWavParts(channels, cache.sampleRate, format === 'wav24' ? 24 : 16);
        mime = 'audio/wav'; ext = 'wav';
      }
      send({ type: 'exported', parts, mime, ext, stats }, parts.map((p) => p.buffer));
    } catch (err) {
      if (err instanceof CancelledError) send({ type: 'cancelled', scope: 'export' });
      else send({ type: 'error', code: 'RENDER_FAILED', message: 'Could not render the result. Please try again.', detail: String(err && err.message) });
    }
  }

  return {
    handle(msg) {
      if (msg.type === 'cancel') { cancelled = true; return; }
      if (msg.type === 'process') return process(msg);
      if (msg.type === 'preview') return render(msg, renderWindow, 'previewed');
      if (msg.type === 'render') return render(msg, renderOutput, 'rendered'); // studio: full-length float result, no encoding
      if (msg.type === 'previewAB') return previewAB(msg);
      if (msg.type === 'export') return exportFile(msg);
    },
  };
}
