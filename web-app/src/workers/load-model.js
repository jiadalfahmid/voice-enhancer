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

async function loadGtcrn() {
  const ort = await import('onnxruntime-web/wasm');
  const base = `${self.location.origin}${import.meta.env.BASE_URL}`;
  ort.env.wasm.wasmPaths = `${base}ort/`;
  ort.env.wasm.numThreads = 1; // one tiny frame per call: threading overhead would cost more than it saves
  const res = await fetch(`${base}models/gtcrn_simple.onnx`);
  if (!res.ok) throw new Error(`model fetch failed: ${res.status}`);
  const session = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), {
    executionProviders: ['wasm'], graphOptimizationLevel: 'all',
  });
  return createGtcrnModel(ort, session);
}

async function loadDpdfnet16k() {
  const ort = await import('onnxruntime-web/wasm');
  const base = `${self.location.origin}${import.meta.env.BASE_URL}`;
  ort.env.wasm.wasmPaths = `${base}ort/`;
  ort.env.wasm.numThreads = 1;
  const res = await fetch(`${base}models/dpdfnet_baseline.onnx`);
  if (!res.ok) throw new Error(`model fetch failed: ${res.status}`);
  const session = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), {
    executionProviders: ['wasm'], graphOptimizationLevel: 'all',
  });
  return createDpdfnetModel(ort, session);
}

async function loadDpdfnet48k() {
  const ort = await import('onnxruntime-web/wasm');
  const base = `${self.location.origin}${import.meta.env.BASE_URL}`;
  ort.env.wasm.wasmPaths = `${base}ort/`;
  ort.env.wasm.numThreads = 1;
  const res = await fetch(`${base}models/dpdfnet_48k.onnx`);
  if (!res.ok) throw new Error(`model fetch failed: ${res.status}`);
  const session = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), {
    executionProviders: ['wasm'], graphOptimizationLevel: 'all',
  });
  return createDpdfnet48kModel(ort, session);
}

async function loadDeepfilternet3() {
  const base = `${self.location.origin}${import.meta.env.BASE_URL}`;
  const [wasmRes, modelRes] = await Promise.all([
    fetch(`${base}models/deepfilternet3/df_bg.wasm`),
    fetch(`${base}models/deepfilternet3/DeepFilterNet3_onnx.bin`),
  ]);
  if (!wasmRes.ok) throw new Error(`DeepFilterNet3 wasm fetch failed: ${wasmRes.status}`);
  if (!modelRes.ok) throw new Error(`DeepFilterNet3 model fetch failed: ${modelRes.status}`);
  const [wasmBytes, modelBytes] = await Promise.all([
    wasmRes.arrayBuffer(),
    modelRes.arrayBuffer(),
  ]);
  return createDeepfilternet3Model(wasmBytes, modelBytes);
}

export function loadModel(id) {
  if (id === 'gtcrn') {
    gtcrn ||= loadGtcrn().catch((e) => { gtcrn = null; throw e; });
    return gtcrn;
  }
  if (id === 'dpdfnet-16k') {
    dpdfnet16k ||= loadDpdfnet16k().catch((e) => { dpdfnet16k = null; throw e; });
    return dpdfnet16k;
  }
  if (id === 'dpdfnet-48k') {
    dpdfnet48k ||= loadDpdfnet48k().catch((e) => { dpdfnet48k = null; throw e; });
    return dpdfnet48k;
  }
  if (id === 'deepfilternet3') {
    deepfilternet3 ||= loadDeepfilternet3().catch((e) => { deepfilternet3 = null; throw e; });
    return deepfilternet3;
  }
  return builtinLoader(id);
}

