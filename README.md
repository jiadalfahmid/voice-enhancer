# Voice Enhancer: browser-based AI speech enhancer (project README and handoff)

**New direction (2026-10-15): ClearVoice Studio. Training is paused. Read `docs/PRODUCTION_CHECKLIST.md` and `docs/MODEL_INTEGRATION.md` first.**

**Read this first if you are a new Claude chat taking over.** It holds everything needed to continue without the old conversation.
The owner works fast, pastes errors and outputs back, wants working downloads (ZIPs), and expects honesty about what is tested and what is not.

## Goal
Upload a recording (mp3/mp4/wav...), get back audio that sounds like it was recorded with a **professional microphone**: clear and crisp,
**no robotic, echoey or watery artifacts**, background noise AND other people's voices reduced, loudness consistent. Runs fully in the browser
(nothing uploaded). Long term: train our own model ("make it a beast"). Spec: `docs/PRD.md` (v2). Owner's recordings are on-set camera audio
(English and Bangla; "scene takes"), often echoey, distant and noisy.

## Status
| Milestone | State |
| --- | --- |
| M0 foundations (Vite/React, COOP/COEP headers, capability checks) | done, verified by owner |
| M1 file pipeline (STFT, resample, LUFS, limiter, worker, GTCRN via onnxruntime-web) | done, verified by owner (33 min file in ~6 min = 5.5x real time) |
| M2 UX (A/B player, WAV/MP3 export, presets, error states) | done, "works perfectly" per owner |
| M3 training toolkit (`ai-training/`) | written; smoke test PASSED on Colab (GRU and GTCRN); **real fine-tune not run yet** |
| Studio (new plan: compare pretrained models, optional second pass) | core + UI built, tests pass in Node; first browser run is `docs/PRODUCTION_CHECKLIST.md` step 3 |
| M4 export trained model to stateful ONNX + parity test + int8 | not started |
| M5+ live/mic mode, batch, smart analysis | not started (PRD sections 7.2, 14) |

## Repo map
- `web-app/`: React/Vite app. `src/audio/` pure DSP modules (stft, resample, hpf, lufs, limiter, mixer, pipeline, postprocess, presets, gtcrn adapter, encode-wav/mp3),
  `src/workers/` (file worker core, model loader), `src/components/` (EnhancerUI, ABPlayer), `public/models/gtcrn_simple.onnx`, `tests/unit/` (86 tests).
- `ai-training/`: Python toolkit (augment, dataset, model, losses, train, infer, metrics, bench_clips, fetch_datasets, prepare_data, smoke_test, tests: 25 pass without PyTorch).
- `colab/02_train.ipynb`, `colab/01_compare_models.ipynb`, `kaggle/train_kaggle.ipynb`: notebooks.
- `docs/PRD.md`, `docs/BASELINE.md` (measured numbers per model/clip: add every new model here).

## Run the web app (owner is on Windows, Git Bash)
```
cd web-app
npm install                      # postinstall copies the ONNX runtime to public/ort
npm test                         # includes a real onnxruntime-web check against Python-onnxruntime golden outputs
npm run dev
```
Owner's environment after `npm audit fix --force`: Vite 8.x, Vitest 5.x, `@vitejs/plugin-react` upgraded to ^5.2 (Vite 8 support). Known-good fallback:
`npm install -D vite@5.4.21 vitest@2.1.9 @vitejs/plugin-react@4.7.0`. MP3 export needs `@breezystack/lamejs@1.2.7` (LGPL-3.0; keep separable).

## How the web pipeline works (web-app/src/audio/pipeline.js)
dry = untouched input. Model path: 80 Hz high-pass -> resample to 16 kHz -> chunks of 30 s (2 s overlap, 1 s crossfade, fresh model state per chunk) ->
STFT (FFT 512, hop = model hop, sqrt-Hann) -> model returns the enhanced complex spectrum -> optional polish (suppression depth, late-reverb subtraction,
clarity EQ) -> ISTFT -> resample back -> add the >8 kHz band from the input scaled by the model's smoothed 4-8 kHz gain. Stereo: the model sees the mono
mix, other channels get its complex mask; option "Centre the voice" outputs mono. Loudness: BS.1770 K-weighted energies of dry and wet are cached so the
strength slider is instant; 20 s previews; full render + limiter (-1 dBTP, 4x true-peak detection) only on export. Model contract: `{id,label,hop,createState(),process(re,im,T,state)}` (src/audio/models.js, gtcrn.js).
GTCRN: 16 kHz, FFT 512, hop 256, ~24 K params in the stream ONNX; inputs mix [1,257,1,2] + 3 caches, output `enh` = enhanced spectrum. The default preset is **Natural** (model only);
echo reduction and strong depth are experimental and can sound watery (never validated by ear).

## What we measured and heard
- Stand-in GTCRN removes steady noise very well (speech-to-floor +47 dB on the "Rejected scene 3" clip) but leaves the room tail (~350 ms median 30 dB decay),
  keeps other talkers, and loses 4-8 dB above 7 kHz relative to the rest. Details and method: `docs/BASELINE.md`, `ai-training/metrics.py`.
- The dull step near 4.3 kHz is mostly in the source recording (AAC/MP3 camera audio); the model removes 2-5 dB more. GTCRN is NOT level-sensitive (tested).
- **Blind listening test (owner, 2026-10-12)** on 2 clips ("Echo", "background noise") with 4 candidates each, loudness matched to -20 LUFS, scored 1-5
  for Naturalness / Echo-noise removal / Clarity / Professional sound. The owner wrote: "I swapped the names of the test, evaluate by swapping them back."
  Reading the key as printed (Echo: A=resemble_enhance, B=original, C=resemble_denoise, D=deepfilternet; background-noise: A=original, B=resemble_enhance, C=deepfilternet, D=resemble_denoise):
  favourites were C (echo) and D (noise) = **resemble_denoise** in both, matching the owner's later statement "I'm going with denoise, I like its output the most".
  Swapping the two clip labels back (the owner's instruction) gives a table where the unprocessed original gets the lowest removal scores (2 and 1) as it should,
  whereas the as-printed reading would give the original 4/5 and 3/5 removal, which is implausible. Swapped-back scores (Nat/Removal/Clarity/Pro):
  - Echo clip: original 3/2/3/1, resemble_enhance 1/4/1/2, **deepfilternet 4/3/4/2 (favourite C)**, resemble_denoise 2/2/2/1
  - Noise clip: resemble_enhance 1/3/1/2, original 3/1/2/1, resemble_denoise 3/3/4/3, **deepfilternet 4/4/4/3 (favourite D)**
  **Owner clarification (2026-10-13):** by "denoise" they mean **Resemble's denoise-only mode**, and they confirm the clip names "Echo" and "background-noise" were swapped in the test (the swap-back above).
  **Still inconsistent, flag it:** with the swap-back, the scores favour **DeepFilterNet** in both clips (it beats Resemble denoise on all four criteria in both); only the key as printed favours Resemble denoise.
  The owner's stated preference is Resemble denoise. Treat that as the preference, but it has not been reconciled with the score sheet. Cheap tie-break: the owner uploads the 8 blind files
  (letters only) and we identify the unprocessed original per clip from its noise floor and spectrum, which shows which key belongs to which clip; or the owner re-listens to the two DFN and two Resemble-denoise files side by side.
  Both readings agree that Resemble's generative "enhance" mode is not the winner for naturalness in at least one clip; do not build on it without more listening.
  Before using any Resemble output as training targets (teacher/distillation), confirm its license on its GitHub page (not verified in this project).

## M3: training (see `ai-training/README.md`)
Plan: Track A = fine-tune pretrained GTCRN on far-field + interfering-talker + codec + band-limit mixtures (`--preset farfield`, target mode `early` = direct sound + first 50 ms of room);
Track B = larger model from scratch (`--arch gru`, complex mask that may exceed 1 so it can restore energy). Data: LibriTTS-R (restored, CC BY 4.0) + OpenSLR SLR28 RIRs/noises (Apache 2.0).
Limits to know: SLR28 gives only 839 train / 96 val noise files (low noise diversity: add DEMAND/FSD50K/MS-SNSD after license checks); no Bangla data yet (add Bangla speech if Bangla matters);
model selection is by val loss + SI-SDR + the new high-band metric (DNSMOS/PESQ not wired).
- Timing test: data mixing ~38 ms/example/core (codec round trips dominate), so ~3 min per 1000-step epoch with 4 workers (Kaggle) and ~5 min with 2 (Colab). Estimates, not measured end to end.
- **The owner's current `ft1` checkpoint is only 40 steps** (a 2x20-step test), not a real fine-tune. Even so it already shifted behavior: more denoising and a shorter echo tail than pretrained, but 3-8 kHz dulled more
  (`docs/BASELINE.md`, Bangla section). The real run prints "high-band energy vs clean target" per epoch: if 3-5k/5-7k/7-8k sink below about -6 dB, stop and fix (e.g. weight HF in the loss, lower LR, fewer band-limited samples).
- Platforms: owner has no GPU. Colab free GPU quota ran out ("not connecting"), so Kaggle is primary and Colab the backup. Datasets are re-downloaded each session (aria2c, 3 openslr mirrors, pinned SHA-256s);
  only checkpoints persist (Drive on Colab, notebook output on Kaggle).

## Bugs found and fixed so far (so you do not repeat them)
`us.openslr.org` has a TLS hostname mismatch (use www.openslr.org or the mirrors in `fetch_datasets.py`); run data download and `prepare_data` BEFORE training (empty list error otherwise);
`npm audit fix --force` bumped Vite/Vitest majors (works for the owner after upgrading plugin-react); `@breezystack/lamejs` must be installed or MP3 export reports unavailable;
limiter init bug and true-peak detector length (fixed in M1); `dry` must be the untouched input (fixed).

## Next steps (suggested order)
1. Resolve the blind-test mapping with the owner; decide the engine direction: (a) fine-tune/train our own (in progress), (b) port DeepFilterNet3 (48 kHz full band, MIT/Apache) to the browser (needs a port of its DSP; large), (c) use a big model (Resemble denoise) only as a teacher to create training targets (check its license first).
2. Run the real Kaggle fine-tune (`kaggle/train_kaggle.ipynb`), watch val SI-SDR and the high-band line, then compare with `infer.py` + `bench_clips.py` on the owner's clips (add rows to `docs/BASELINE.md`) and do another blind test against pretrained GTCRN.
3. Export the best checkpoint with GTCRN's stream converter (`gtcrn/stream/`), run an ONNX parity test against PyTorch (like `web-app/tests/unit/gtcrn-ort.test.js`), drop it into `public/models/`, listen again.
4. Add noise diversity and Bangla data; try Track B; add DNSMOS if the licenses allow.
5. Later: streaming/live mode (PRD 7.2), smart analysis, batch, quality report.

## Ground rules that worked
Say what is untested; verify URLs/package names with a search before putting them in code (never invent links); keep deliverables as a ZIP of the whole project with tests passing;
keep answers short and actionable; do not silently change defaults that affect sound; never store secrets.
