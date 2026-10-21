# Adding a model

The studio only needs this contract (`src/studio/types.ts`):

    { info, load(signal), run({channels, sampleRate}, {signal, onProgress}) -> {channels, sampleRate}, dispose() }

`run` must return the same number of samples as it got (the coordinator rejects anything else), at the same sample rate, and must
stop when `signal` aborts. Never modify `input.channels`.

## Which kind of model do you have?
A. Same shape as GTCRN (spectral, FFT 512, 16 kHz, per-frame states): copy `src/audio/gtcrn.js`, register it in `src/workers/load-model.js`,
   then wrap it exactly like GTCRN in `src/studio/runtime.js` (`createPipelineEngine`). The existing pipeline does resampling, chunking, loudness and limiting for you.
B. Anything else (different FFT size or sample rate, such as 48 kHz models): write a whole-signal engine with its own worker.
   Do not force it into the 512-FFT pipeline.

## Inspect an ONNX file (run on your computer)

    import onnxruntime as ort
    s = ort.InferenceSession("model.onnx", providers=["CPUExecutionProvider"])
    for i in s.get_inputs(): print("IN ", i.name, i.shape, i.type)
    for o in s.get_outputs(): print("OUT", o.name, o.shape, o.type)

Paste the output to me: it tells us whether the graph takes a waveform or a spectrum, and which tensors are recurrent state.

## Skeleton for kind B (fill the TODOs)
Main thread, `src/studio/my-engine.js`:

    export function createMyEngine({ info }) {
      let worker = null;
      return {
        info,
        async load() {},                      // the worker loads the model on first run
        run(input, { signal, onProgress }) {
          return new Promise((resolve, reject) => {
            worker ||= new Worker(new URL('../workers/worker-my.js', import.meta.url), { type: 'module' });
            const abort = () => { worker.terminate(); worker = null; reject(new DOMException('cancelled', 'AbortError')); };
            if (signal.aborted) return abort();
            signal.addEventListener('abort', abort, { once: true });
            worker.onmessage = (e) => {
              if (e.data.type === 'progress') onProgress(e.data.value);
              else if (e.data.type === 'done') { signal.removeEventListener('abort', abort); resolve({ channels: e.data.channels, sampleRate: input.sampleRate }); }
              else if (e.data.type === 'error') { signal.removeEventListener('abort', abort); reject(new Error(e.data.message)); }
            };
            const channels = input.channels.map((c) => c.slice());       // worker takes ownership of what it receives
            worker.postMessage({ channels, sampleRate: input.sampleRate }, channels.map((c) => c.buffer));
          });
        },
        dispose() { worker?.terminate(); worker = null; },
      };
    }

Worker, `src/workers/worker-my.js`: load the model with `onnxruntime-web/wasm` (copy `loadGtcrn` in `load-model.js`: same-origin `wasmPaths`, `numThreads`),
resample each channel to the model rate with `resampleChunked`, run the model in chunks carrying its state, resample back, trim/pad to the
input length, then finish with `normalizeToLufs(..., -16)` and `limit(...)` (see `renderOutput` in `src/audio/pipeline.js`) so the result
matches the other engines. Post `progress` messages between chunks.

## Done when
parity test passes, phone timing recorded, license line added, `availability: 'browser-ready'` set, and `npm run test:studio` still passes.
