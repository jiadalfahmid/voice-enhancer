// DPDFNet 48 kHz ONNX adapter for ONNX Runtime Web.
// Per-frame streaming:
//   Inputs:  spec [1, 1, 481, 2], state_in [56436]
//   Outputs: spec_e [1, 1, 481, 2], state_out [56436]

import { createDpdfnet48kInitialState, DPDFNET48K_STATE_SIZE } from './dpdfnet48k-state.js';
import { DPDFNET48K_BINS, DPDFNET48K_HOP_LEN } from './dpdfnet48k-stft.js';

export function createDpdfnet48kModel(ort, session) {
  const inSpecName = (session.inputNames && session.inputNames[0]) || 'spec';
  const inStateName = (session.inputNames && session.inputNames[1]) || 'state_in';
  const outSpecName = (session.outputNames && session.outputNames[0]) || 'spec_e';
  const outStateName = (session.outputNames && session.outputNames[1]) || 'state_out';

  return {
    id: 'dpdfnet-48k',
    label: 'DPDFNet 48 kHz (Apache-2.0)',
    sampleRate: 48000,
    hop: DPDFNET48K_HOP_LEN,
    createState: () => createDpdfnet48kInitialState(),

    /**
     * Sequential frame-by-frame inference carrying recurrent state.
     * @param {Float32Array} re - Flattened real components [T * 481]
     * @param {Float32Array} im - Flattened imag components [T * 481]
     * @param {number} T - Number of frames
     * @param {Float32Array} state - Recurrent state [56436]
     * @param {{tick?: () => Promise<void>}} [opts]
     * @returns {Promise<{re: Float32Array, im: Float32Array, state: Float32Array}>}
     */
    async process(re, im, T, state, { tick } = {}) {
      const outRe = new Float32Array(T * DPDFNET48K_BINS);
      const outIm = new Float32Array(T * DPDFNET48K_BINS);
      const frameBuffer = new Float32Array(DPDFNET48K_BINS * 2);

      let curState = state instanceof Float32Array && state.length === DPDFNET48K_STATE_SIZE
        ? state
        : createDpdfnet48kInitialState();

      for (let t = 0; t < T; t++) {
        const frameOffset = t * DPDFNET48K_BINS;
        for (let k = 0; k < DPDFNET48K_BINS; k++) {
          frameBuffer[2 * k] = re[frameOffset + k];
          frameBuffer[2 * k + 1] = im[frameOffset + k];
        }

        const specTensor = new ort.Tensor('float32', frameBuffer, [1, 1, DPDFNET48K_BINS, 2]);
        const stateTensor = new ort.Tensor('float32', curState, [DPDFNET48K_STATE_SIZE]);

        const feeds = {
          [inSpecName]: specTensor,
          [inStateName]: stateTensor,
        };

        const out = await session.run(feeds);

        const outSpecTensor = out[outSpecName];
        const outStateTensor = out[outStateName];

        const eData = outSpecTensor.data;
        for (let k = 0; k < DPDFNET48K_BINS; k++) {
          outRe[frameOffset + k] = eData[2 * k];
          outIm[frameOffset + k] = eData[2 * k + 1];
        }

        // Copy state data for the next frame
        curState = new Float32Array(outStateTensor.data);

        // Clean up tensors if dispose is supported
        specTensor.dispose?.();
        stateTensor.dispose?.();
        outSpecTensor.dispose?.();
        outStateTensor.dispose?.();

        if (tick && (t & 127) === 127) await tick();
      }

      // Update state in-place if caller holds the reference
      if (state && state.set && state !== curState) {
        state.set(curState);
      }

      return { re: outRe, im: outIm, state: curState };
    },
  };
}
