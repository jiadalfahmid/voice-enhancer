// Browser-only model loader for the worker: GTCRN through onnxruntime-web (WASM). Same-origin files only
// (public/ort/* copied by scripts/copy-ort.mjs, public/models/gtcrn_simple.onnx).
import { createGtcrnModel } from '../audio/gtcrn.js';
import { createDpdfnetModel } from '../audio/dpdfnet.js';
import { createDpdfnet48kModel } from '../audio/dpdfnet48k.js';
import { createDeepfilternet3Model } from '../audio/deepfilternet3.js';
import { builtinLoader } from '../audio/models.js';

let gtcrn = null;
let dpdfnet16k = null;
let dpdfnet48k = null;
let deepfilternet3 = null;

async function fetchWithProgress(url, { onStatus, label = 'model' } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} fetch failed: ${res.status}`);
  const total = parseInt(res.headers.get('content-length') || '0', 10);
  if (!res.body || !total || !onStatus) {
    return new Uint8Array(await res.arrayBuffer());
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    const mbLoaded = (loaded / (1024 * 1024)).toFixed(1);
    const mbTotal = (total / (1024 * 1024)).toFixed(1);
    onStatus(`Downloading ${label} (${mbLoaded} / ${mbTotal} MB)...`);
  }
  const result = new Uint8Array(loaded);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

async function loadOrtModel(relPath, label, factory, opts = {}) {
  const ort = await import('onnxruntime-web/wasm');
  const base = `${self.location.origin}${import.meta.env.BASE_URL}`;
  ort.env.wasm.wasmPaths = `${base}ort/`;
  ort.env.wasm.numThreads = 1; // one tiny frame per call: threading overhead would cost more than it saves
  const bytes = await fetchWithProgress(`${base}${relPath}`, { onStatus: opts.onStatus, label });
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'], graphOptimizationLevel: 'all',
  });
  return factory(ort, session);
}

function loadGtcrn(opts = {}) {
  return loadOrtModel('models/gtcrn_simple.onnx', 'GTCRN (1.3 MB)', createGtcrnModel, opts);
}

function loadDpdfnet16k(opts = {}) {
  return loadOrtModel('models/dpdfnet_baseline.onnx', 'DPDFNet-16k (1.2 MB)', createDpdfnetModel, opts);
}

function loadDpdfnet48k(opts = {}) {
  return loadOrtModel('models/dpdfnet_48k.onnx', 'DPDFNet-48k (2.3 MB)', createDpdfnet48kModel, opts);
}

async function loadDeepfilternet3(opts = {}) {
  const base = `${self.location.origin}${import.meta.env.BASE_URL}`;
  const [wasmBytes, modelBytes] = await Promise.all([
    fetchWithProgress(`${base}models/deepfilternet3/df_bg.wasm`, { onStatus: opts.onStatus, label: 'DeepFilterNet3 WASM' }),
    fetchWithProgress(`${base}models/deepfilternet3/DeepFilterNet3_onnx.bin`, { onStatus: opts.onStatus, label: 'DeepFilterNet3 Weights (8.5 MB)' }),
  ]);
  return createDeepfilternet3Model(wasmBytes.buffer, modelBytes.buffer);
}

export function loadModel(id, opts = {}) {
  if (id === 'gtcrn') {
    gtcrn ||= loadGtcrn(opts).catch((e) => { gtcrn = null; throw e; });
    return gtcrn;
  }
  if (id === 'dpdfnet-16k') {
    dpdfnet16k ||= loadDpdfnet16k(opts).catch((e) => { dpdfnet16k = null; throw e; });
    return dpdfnet16k;
  }
  if (id === 'dpdfnet-48k') {
    dpdfnet48k ||= loadDpdfnet48k(opts).catch((e) => { dpdfnet48k = null; throw e; });
    return dpdfnet48k;
  }
  if (id === 'deepfilternet3') {
    deepfilternet3 ||= loadDeepfilternet3(opts).catch((e) => { deepfilternet3 = null; throw e; });
    return deepfilternet3;
  }
  return builtinLoader(id);
}

