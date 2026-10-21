// DPDFNet 16 kHz ONNX adapter for ONNX Runtime Web.
// Per-frame streaming:
//   Inputs:  spec [1, 1, 161, 2], state_in [38256]
//   Outputs: spec_e [1, 1, 161, 2], state_out [38256]
import { createDpdfnetInitialState, DPDFNET_STATE_SIZE } from './dpdfnet-state.js';
import { DPDFNET_BINS, DPDFNET_HOP_LEN } from './dpdfnet-stft.js';

export function createDpdfnetModel(ort, session) {
  const inSpecName = (session.inputNames && session.inputNames[0]) || 'spec';
  const inStateName = (session.inputNames && session.inputNames[1]) || 'state_in';
  const outSpecName = (session.outputNames && session.outputNames[0]) || 'spec_e';
  const outStateName = (session.outputNames && session.outputNames[1]) || 'state_out';

  return {
    id: 'dpdfnet-16k',
    label: 'DPDFNet 16 kHz (Apache-2.0)',
    hop: DPDFNET_HOP_LEN,
    createState: () => createDpdfnetInitialState(),
    /**
     * Sequential frame-by-frame inference carrying recurrent state.
     * @param {Float32Array} re - Flattened real components [T * 161]
     * @param {Float32Array} im - Flattened imag components [T * 161]
     * @param {number} T - Number of frames
     * @param {Float32Array} state - Recurrent state [38256]
     * @param {{tick?: () => Promise<void>}} [opts]
     * @returns {Promise<{re: Float32Array, im: Float32Array, state: Float32Array}>}
     */
    async process(re, im, T, state, { tick } = {}) {
      const outRe = new Float32Array(T * DPDFNET_BINS);
      const outIm = new Float32Array(T * DPDFNET_BINS);
      const frameBuffer = new Float32Array(DPDFNET_BINS * 2);

      let curState = state instanceof Float32Array && state.length === DPDFNET_STATE_SIZE
        ? state
        : createDpdfnetInitialState();

      for (let t = 0; t < T; t++) {
        const frameOffset = t * DPDFNET_BINS;
        for (let k = 0; k < DPDFNET_BINS; k++) {
          frameBuffer[2 * k] = re[frameOffset + k];
          frameBuffer[2 * k + 1] = im[frameOffset + k];
        }

        const specTensor = new ort.Tensor('float32', frameBuffer, [1, 1, DPDFNET_BINS, 2]);
        const stateTensor = new ort.Tensor('float32', curState, [DPDFNET_STATE_SIZE]);

        const feeds = {
          [inSpecName]: specTensor,
          [inStateName]: stateTensor,
        };

        const out = await session.run(feeds);

        const outSpecTensor = out[outSpecName];
        const outStateTensor = out[outStateName];

        const eData = outSpecTensor.data;
        for (let k = 0; k < DPDFNET_BINS; k++) {
          outRe[frameOffset + k] = eData[2 * k];
          outIm[frameOffset + k] = eData[2 * k + 1];
        }

        // Copy state data for the next frame
        curState = new Float32Array(outStateTensor.data);

        // Clean up tensors if dispose is supported (e.g. wasm backend)
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
