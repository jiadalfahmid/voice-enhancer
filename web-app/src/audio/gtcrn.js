// GTCRN (streaming, MIT) adapter. Model: gtcrn_simple.onnx, 16 kHz, FFT 512, hop 256, sqrt-Hann.
// Per frame it takes mix [1,257,1,2] (re, im interleaved per bin) + three cache tensors and returns the
// ENHANCED complex spectrum `enh` [1,257,1,2] + updated caches. Caches start at zero.
// `ort` (onnxruntime-web) and `session` are injected so this file is testable without a browser.
import { N_BINS } from './stft.js';

export const GTCRN_HOP = 256;
const DIMS = { conv: [2, 1, 16, 16, 33], tra: [2, 3, 1, 1, 16], inter: [2, 1, 33, 16] };
const size = (d) => d.reduce((a, b) => a * b, 1);

export function createGtcrnModel(ort, session) {
  const zeros = (d) => new ort.Tensor('float32', new Float32Array(size(d)), d);
  return {
    id: 'gtcrn',
    label: 'GTCRN (MIT, 16 kHz)',
    hop: GTCRN_HOP,
    createState: () => ({ conv: zeros(DIMS.conv), tra: zeros(DIMS.tra), inter: zeros(DIMS.inter) }),
    async process(re, im, T, state, { tick } = {}) {
      const outRe = new Float32Array(T * N_BINS), outIm = new Float32Array(T * N_BINS);
      const mix = new Float32Array(N_BINS * 2);
      let { conv, tra, inter } = state;
      for (let t = 0; t < T; t++) {
        const o = t * N_BINS;
        for (let k = 0; k < N_BINS; k++) { mix[2 * k] = re[o + k]; mix[2 * k + 1] = im[o + k]; }
        const out = await session.run({
          mix: new ort.Tensor('float32', mix, [1, N_BINS, 1, 2]),
          conv_cache: conv, tra_cache: tra, inter_cache: inter,
        });
        const e = out.enh.data;
        for (let k = 0; k < N_BINS; k++) { outRe[o + k] = e[2 * k]; outIm[o + k] = e[2 * k + 1]; }
        conv = out.conv_cache_out; tra = out.tra_cache_out; inter = out.inter_cache_out;
        if (tick && (t & 255) === 255) await tick();
      }
      state.conv = conv; state.tra = tra; state.inter = inter;
      return { re: outRe, im: outIm };
    },
  };
}
