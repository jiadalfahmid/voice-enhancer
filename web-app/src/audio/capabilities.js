// Capability detection (PRD section 8). Pure functions where possible so they unit-test easily.

// Minimal wasm module that uses a SIMD instruction; validate() is true only if SIMD is supported.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0,
  65, 0, 253, 15, 253, 98, 11,
]);

export function wasmSimdSupported() {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

// PRD 7.4: numThreads = crossOriginIsolated ? min(4, hardwareConcurrency) : 1
export function pickWasmThreads(isolated, hardwareConcurrency = 1) {
  return isolated ? Math.max(1, Math.min(4, hardwareConcurrency || 1)) : 1;
}

export function detectCapabilities(g = globalThis) {
  const isolated = !!g.crossOriginIsolated;
  const hasSAB = typeof g.SharedArrayBuffer !== 'undefined';
  const hasWorklet = typeof g.AudioWorklet !== 'undefined';
  const hasWebGPU = !!(g.navigator && g.navigator.gpu);
  const simd = wasmSimdSupported();
  const cores = (g.navigator && g.navigator.hardwareConcurrency) || 1;

  return {
    crossOriginIsolated: isolated,
    sharedArrayBuffer: hasSAB && isolated,
    wasmSimd: simd,
    audioWorklet: hasWorklet,
    webgpu: hasWebGPU,
    wasmThreads: pickWasmThreads(isolated, cores),
    // Fallback decisions from the matrix
    liveMode: hasWorklet ? (isolated && hasSAB ? 'full' : 'compatibility') : 'disabled',
    ortBuild: simd ? 'simd' : 'non-simd',
  };
}

/** Can the file workflow run at all? (single-thread fallback is fine; we do not need isolation for it.) */
export function fileModeSupport(g = globalThis) {
  const reasons = [];
  if (typeof g.Worker === 'undefined') reasons.push('Web Workers are not available.');
  if (typeof g.WebAssembly !== 'object') reasons.push('WebAssembly is not available.');
  if (typeof g.AudioContext === 'undefined' && typeof g.webkitAudioContext === 'undefined') reasons.push('Web Audio is not available.');
  return { supported: reasons.length === 0, reasons };
}
