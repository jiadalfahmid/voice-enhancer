# ClearVoice Studio: production checklist (do these in order)

Legend: [you] = you do it, [me] = paste me the output and I write the code.
What I could NOT do: run `npm install`, Vite, or a browser (my sandbox has no network). The studio logic and the engine wrapper are tested
in Node (17 tests, including the real worker code). The React screens are syntax-checked only, so step 2 is where the first real run happens.

## A. Check this drop (about 20 minutes)
1. [you] Copy the new files over your repo (or replace the folder). In `web-app/`: `npm install` then `npm test`.
   Your old tests (86) must still pass. I changed 4 old files a little (worker core got a `render` message, file-client got `render()`,
   ABPlayer got label props, `_headers`). If any old test fails, paste me the error.
2. [you] `npm run typecheck:studio` and `npm run test:studio` (needs Node 22.6 or newer). Expect 17 passing tests.
3. [you] `npm run dev`, open the page, and walk through this with a 30-60 s clip:
   drop file -> "Enhance original" with GTCRN -> Compare (A original, B result) -> Download WAV -> "Enhance again" (read the warnings) ->
   Discard the stage 2 -> import any other WAV as a result -> Cancel a run halfway. `http://localhost:5173/#classic` must still show your old app.
4. [you] Same walk-through on your Android phone: `npm run build`, `npm run preview`, open the LAN address in Chrome.
   Note the time it takes and whether the tab survives a 5-minute file. Tell me the numbers.

## B. Phase 1: decide which models deserve integration (before writing any model code)
5. [you] Pick 6-8 clips (Bangla and English, echoey, noisy, clean). Run each candidate on them on your computer:
   - DPDFNet: `pip install dpdfnet`, then `dpdfnet enhance noisy.wav out.wav --model dpdfnet4` (try dpdfnet2/4/8 and the 48 kHz model from its model card).
   - DeepFilterNet: `pip install deepfilternet`, then `deepFilter noisy.wav -o out_dir`.
   - Resemble Enhance (denoise-only, your favourite) and your GTCRN ft4 (your own scripts).
6. [you] Import every output into the studio ("Add a result made elsewhere") and listen with the A/B player. Fill `docs/BASELINE.md`
   (quality, consonants in Bangla, size, runtime). Keep the 1-2 models that win. Skip integrating the rest.

## C. Add each winning model (repeat per model; details in docs/MODEL_INTEGRATION.md)
7. [you] Get the weights from the official source and write down: URL, file size, sha256, license text. The model cards I found say
   DPDFNet is Apache-2.0 (Hugging Face `Ceva-IP/DPDFNet`, ONNX files in `onnx/`) and DeepFilterNet is MIT OR Apache-2.0. Confirm both yourself on the exact files.
8. [you] Inspect the ONNX inputs/outputs with the 5-line Python snippet in MODEL_INTEGRATION.md. [me] Paste me the output and I write the adapter.
9. [you] Put the file in `web-app/public/models/`, add its adapter to `src/studio/runtime.js`, set `availability: 'browser-ready'` in `src/studio/engines.ts`.
10. [you] Parity test: run the same 5-second clip through Python and through the browser adapter; outputs must match closely
    (your GTCRN test `gtcrn-ort.test.js` is the pattern). Do not ship a model that has no parity test.
11. [you] Measure on your phone: seconds of processing per minute of audio, peak memory (Chrome: chrome://inspect > Memory). Write it in BASELINE.md.
12. [you] Add a line to `public/THIRD-PARTY-NOTICES.txt` and fix the license text in `engines.ts`.

## D. Optional: your ft4 model
13. [me] Only if ft4 wins step 6: ask me for the stateful ONNX export script plus parity test (README milestone M4). Then repeat section C.

## E. Harden (the plan's "definition of done")
14. [you] Try these and tell me what breaks: a 9-minute file on the phone, a corrupt file, a .amr or .wma file, a file with no audio track, cancel at 10 / 50 / 90%,
    reload during processing, two tabs open, Safari on iPhone if you have one, airplane mode after the first load.
15. [you] Run `npm audit`. Keep exact versions in package.json, commit `package-lock.json`, and install with `npm ci`. Do not add a package you
    have not looked up (npm has had large malware waves). Self-host every model and WASM file: the CSP blocks other origins on purpose.

## F. Deploy (free)
16. [you] Cloudflare Pages: connect the repo, root `web-app`, build command `npm run build`, output `dist`. It reads `public/_headers`.
    Keep every file under its 25 MiB per-file limit (check the ORT .wasm in `dist/ort/` and each model).
    Do NOT use GitHub Pages: it cannot set the COOP/COEP headers the multi-thread WASM runtime needs.
17. [you] On the live URL open DevTools: `crossOriginIsolated` must print `true`, the Console must show no CSP errors, Network must show models
    served with `cache-control: immutable`. Run steps 3 and 4 again on the live site and on your phone.
18. [you] Release when: GTCRN plus at least one more model work on your phone, licenses page is filled, step 14 has no crashes.
    Anything that fails: send me the console error and the step number.

## Known limits of this version
- One model runs at a time (the worker keeps a single result cache). Parallel models come later.
- Memory: every version is stored as full float audio, so there is a per-device cap (10 min on typical phones, 30 min on 8 GB devices) and the app refuses a new result instead of deleting one silently.
- Stored results are loudness-normalised to -16 LUFS; the A/B player matches both sides to -20 LUFS so comparisons are fair.
- DeepFilterNet3, DPDFNet and ft4 show as "Not yet supported" until you finish section C. Resemble Enhance stays offline (import its output).
- The new core is TypeScript; the screens are still JSX like your old app. Convert later if you want.
