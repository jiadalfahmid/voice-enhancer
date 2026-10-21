// DeepFilterNet3 WASM Adapter for Voice Enhancer.
// Links df_bg.wasm and DeepFilterNet3_onnx.tar.gz via the WebAssembly runtime.
// Operates natively at 48000 Hz with 480-sample time-domain frames (10 ms).

let cachedFloat32Memory = null;
let cachedUint8Memory = null;
let wasmVectorLen = 0;
let wasmInstance = null;
let cachedTextDecoder = null;

function getTextDecoder() {
  if (!cachedTextDecoder) {
    cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
  }
  return cachedTextDecoder;
}

function getFloat32Memory(wasm) {
  if (!cachedFloat32Memory || cachedFloat32Memory.buffer !== wasm.memory.buffer) {
    cachedFloat32Memory = new Float32Array(wasm.memory.buffer);
  }
  return cachedFloat32Memory;
}

function getUint8Memory(wasm) {
  if (!cachedUint8Memory || cachedUint8Memory.buffer !== wasm.memory.buffer) {
    cachedUint8Memory = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8Memory;
}

function passArray8ToWasm(arg, wasm) {
  const ptr = wasm.__wbindgen_malloc_command_export(arg.length, 1) >>> 0;
  getUint8Memory(wasm).set(arg, ptr);
  wasmVectorLen = arg.length;
  return ptr;
}

function passArrayF32ToWasm(arg, wasm) {
  const ptr = wasm.__wbindgen_malloc_command_export(arg.length * 4, 4) >>> 0;
  getFloat32Memory(wasm).set(arg, ptr / 4);
  wasmVectorLen = arg.length;
  return ptr;
}

function getArrayF32FromWasm(ptr, len, wasm) {
  return getFloat32Memory(wasm).subarray(ptr >>> 0 >> 2, (ptr >>> 0 >> 2) + len);
}

function getArrayU8FromWasm(ptr, len, wasm) {
  return getUint8Memory(wasm).subarray(ptr >>> 0, (ptr >>> 0) + len);
}

function decodeText(ptr, len, wasm) {
  return getTextDecoder().decode(getUint8Memory(wasm).subarray(ptr >>> 0, (ptr >>> 0) + len));
}

function addToExternrefTable(obj, wasm) {
  const idx = wasm.__externref_table_alloc_command_export();
  wasm.__wbindgen_externrefs.set(idx, obj);
  return idx;
}

function createWasmImports(getWasm) {
  return {
    './df_bg.js': {
      __wbg___wbindgen_throw_344f42d3211c4765(arg0, arg1) {
        const wasm = getWasm();
        throw new Error(decodeText(arg0, arg1, wasm));
      },
      __wbg_getRandomValues_cc7f052a444bb2ce(arg0, arg1) {
        const wasm = getWasm();
        try {
          const slice = getArrayU8FromWasm(arg0, arg1, wasm);
          if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(slice);
          } else if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
            globalThis.crypto.getRandomValues(slice);
          } else {
            // Node.js fallback
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const nodeCrypto = require('crypto');
            nodeCrypto.randomFillSync(slice);
          }
        } catch (e) {
          const idx = addToExternrefTable(e, wasm);
          wasm.__wbindgen_exn_store_command_export(idx);
        }
      },
      __wbg_new_from_slice_ddf8b82c4d6af38e(arg0, arg1) {
        const wasm = getWasm();
        return new Float32Array(getArrayF32FromWasm(arg0, arg1, wasm));
      },
      __wbindgen_init_externref_table() {
        const wasm = getWasm();
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
      },
    },
  };
}

/**
 * Instantiate the DeepFilterNet3 WebAssembly runtime and wrap the model archive.
 * @param {Uint8Array|ArrayBuffer} wasmBytes - Compiled or raw df_bg.wasm
 * @param {Uint8Array|ArrayBuffer} modelBytes - DeepFilterNet3_onnx.tar.gz archive
 * @returns {Promise<object>} Model interface
 */
export async function createDeepfilternet3Model(wasmBytes, modelBytes) {
  let wasm = null;
  const imports = createWasmImports(() => wasm);

  let module;
  if (wasmBytes instanceof WebAssembly.Module) {
    module = wasmBytes;
  } else {
    module = await WebAssembly.compile(wasmBytes);
  }

  const instance = await WebAssembly.instantiate(module, imports);
  wasm = instance.exports;
  wasm.__wbindgen_start();

  const modelU8 = modelBytes instanceof Uint8Array ? modelBytes : new Uint8Array(modelBytes);

  return {
    id: 'deepfilternet3',
    label: 'DeepFilterNet3',
    sampleRate: 48000,
    frameLength: 480,

    /**
     * Create an independent recurrent state handle for speech enhancement.
     * @param {number} attenLim - Attenuation limit in dB (e.g. 100 for maximum suppression).
     */
    createState(attenLim = 100) {
      const ptrModel = passArray8ToWasm(modelU8, wasm);
      const handle = wasm.df_create(ptrModel, wasmVectorLen, attenLim) >>> 0;
      if (!handle) {
        throw new Error('Failed to create DeepFilterNet3 state handle.');
      }
      const frameLength = wasm.df_get_frame_length(handle) >>> 0;
      let freed = false;

      return {
        handle,
        frameLength,

        /**
         * Process a single 480-sample frame at 48 kHz.
         * @param {Float32Array} frameIn - Exactly 480 float samples.
         * @returns {Float32Array} Exactly 480 enhanced float samples.
         */
        processFrame(frameIn) {
          if (freed) throw new Error('Attempt to process frame on freed DeepFilterNet3 state.');
          const ptrIn = passArrayF32ToWasm(frameIn, wasm);
          return wasm.df_process_frame(handle, ptrIn, wasmVectorLen);
        },

        setAttenLim(limDb) {
          if (!freed) {
            wasm.df_set_atten_lim(handle, limDb);
          }
        },

        free() {
          if (!freed) {
            freed = true;
            try {
              wasm.__wbg_dfstate_free(handle, 1);
            } catch {
              // Ignore free errors during cleanup
            }
          }
        },
      };
    },
  };
}
