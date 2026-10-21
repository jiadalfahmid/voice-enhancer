# PRD v2: Browser-Based AI Voice Enhancer

**Status:** Draft v2 (supersedes v1) · **Scope:** MVP through live-mic release **Stack:** PyTorch → ONNX (stateful) → onnxruntime-web (WASM, optional WebGPU) · React + Vite · Web Workers · AudioWorklet

---

## 1. Summary

A privacy-first web app that removes background noise from speech and balances loudness, entirely on-device. Two separate pipelines: **File mode** (offline, fast, highest quality) and **Live mode** (streaming mic, low latency). No audio ever leaves the browser.

## 2. Goals / Non-Goals

**Goals**

- G1: Clean noisy speech files up to 30 min, at least 3x real-time on a mid-range laptop.
- G2: Loudness-balanced output at -16 LUFS (adjustable), true peak ≤ -1 dBTP.
- G3: Live mic enhancement with ≤ 80 ms added latency (stretch: 50 ms).
- G4: Works in Chrome/Edge/Firefox/Safari desktop and Chrome Android, with graceful fallbacks.
- G5: All training data and libraries license-cleared for commercial use.

**Non-goals (v1):** generative voice restoration, music, multi-speaker separation, accounts/payments, server-side processing.

## 3. Users and Core Flows

Podcasters, creators, remote workers, students.

1. **Fix a recording:** upload → process → A/B preview → adjust strength → export.
2. **Clean live mic:** enable mic (headphones warning) → monitor/record enhanced audio → export.
3. **Quick voice-note fix:** preset "Voice note" → one-tap process.

---

## 4. Functional Requirements (with acceptance criteria)

| ID | Requirement | Acceptance criteria | Pri |
| --- | --- | --- | --- |
| F1 | Upload WAV, MP3, M4A, OGG, MP4/WebM (audio track) | Decodes via `decodeAudioData`; unsupported formats show clear error; files >2 GB rejected | P0 |
| F2 | Offline denoise in Web Worker | 10-min file processes in ≤ 3.3 min on reference laptop; UI stays at 60 fps; cancel works within 500 ms | P0 |
| F3 | Pre-inference high-pass (default 80 Hz, toggle) | -3 dB at 80 Hz, 12 dB/oct; bypass is bit-exact | P1 |
| F4 | Dry/wet "strength" slider 0-100% | Dry path delayed by exact model latency; null test at 0% = input; no comb filtering at 50% | P0 |
| F5 | Loudness normalization (file: integrated LUFS; live: short-term) | File output within ±0.5 LU of target; true peak ≤ -1 dBTP | P0 |
| F6 | Look-ahead peak limiter | No samples above ceiling on stress clips; ≤ 1 dB gain reduction on normal speech | P0 |
| F7 | A/B waveform preview with synced playhead and instant toggle | Toggle switches in \< 50 ms without click/pop (10 ms crossfade) | P0 |
| F8 | Export WAV 16/24-bit and MP3 (128/192/256 kbps) | Exports match preview; durations equal within 1 sample | P0 |
| F9 | Live mic mode | Round-trip added latency measured and shown in UI; no dropouts for 30 min | P1 |
| F10 | Headphone/feedback protection | Warning modal on first live use; monitoring defaults to muted when output device is not detected as headphones | P1 |
| F11 | Progress, cancel, error states, retry | Every failure path has user-readable message and recovery action | P0 |
| F12 | Presets: Podcast, Call, Voice note | Preset sets HPF, strength, LUFS target; user changes persist in localStorage | P2 |
| F13 | Capability detection + fallbacks | See section 8 matrix | P0 |
| F14 | Model tier selection (Standard / High quality) | First-run benchmark picks default; user can override | P2 |

## 5. Non-Functional Requirements

- **Privacy:** zero network requests carrying audio. Verified by automated test that blocks all non-same-origin requests during processing. UI states "processed on your device."
- **Performance budgets:** main-thread long tasks \< 50 ms; model download ≤ 5 MB (int8); memory ≤ 1.5 GB for 30-min file (process in chunks, 5-min windows with overlap).
- **Accessibility:** WCAG AA, full keyboard control, ARIA live region for progress, reduced-motion respect.
- **Reliability:** deterministic output for same input/settings (fixed chunking, no random dither unless explicit).
- **Security:** CSP restricting scripts to self; self-host all assets (required by COEP, see 7.4).

---

## 6. Audio Specification (single source of truth)

| Parameter | Value | Notes |
| --- | --- | --- |
| Model sample rate | 16 kHz mono | Wideband speech; 48 kHz model is a later tier |
| Context rate | 48 kHz (or device rate) | Resample 3:1 in / 1:3 out; handle 44.1 kHz via polyphase to 16 kHz |
| STFT | FFT 512, hop 160 (10 ms), Hann (sqrt-Hann analysis/synthesis) | 257 bins |
| Model I/O frame | 1 frame per call (live) or T frames (file) | Stateful GRU |
| Channels | Mono processing; stereo input is downmixed for inference, mask applied per channel (file mode) | Preserve stereo image |
| Algorithmic latency | window overlap 352 samples (22 ms) + hop 10 ms | ≈ 32 ms |
| Live buffering | ring buffer 3 hops (30 ms) default, adaptive | Total target ≤ 80 ms incl. resampling (\~2 ms) and I/O |
| Loudness | ITU-R BS.1770-4 K-weighting, gating -70 LUFS abs / -10 LU rel | Integrated (file), 3 s short-term (live) |
| Limiter | Look-ahead 5 ms, attack 1 ms, release 80 ms, ceiling -1 dBTP (4x oversampled detect) |  |

**Latency compensation:** dry path delay = algorithmic latency + resampler group delay, measured once with an impulse test and stored as a constant per model version.

---

## 7. System Architecture

### 7.1 File Mode (offline)

```
File → decodeAudioData → (main) transfer Float32Array to Worker
Worker: HPF → resample→16k → STFT → ORT (batched T frames, state carried) 
      → mask × noisy complex → ISTFT (overlap-add) → resample→ctx rate
      → delay-aligned dry/wet mix → LUFS measure → gain → limiter → encode
```

- Chunked in 5-min windows with 2 s overlap and crossfade; GRU state reset at chunk boundary with a 1 s warm-up discarded.
- Runs in a dedicated Worker; progress via `postMessage`. Strength slider re-mixes cached wet/dry buffers (no re-inference).

### 7.2 Live Mode (streaming)

```
Mic → AudioWorklet (capture, 128-sample blocks)
   → [SAB ring buffer A: input @ ctx rate]
   → Inference Worker: resample→16k → STFT → ORT (1 frame/call) → ISTFT → resample
   → [SAB ring buffer B: output]
   → AudioWorklet (playback / MediaStreamDestination for recording)
```

- Worklet does I/O only. No ORT, no `fetch`.
- Ring buffers: `Int32Array` control block (read/write indices via `Atomics`) + `Float32Array` data. Underrun → output dry-delayed signal and log counter; overrun → drop oldest.
- Worker loop wakes via `Atomics.waitAsync` / `Atomics.wait` (worker only). Fallback without SAB: `MessagePort` transfer of 480-sample chunks (higher jitter, labelled "Compatibility mode").

### 7.3 Model Spec (Standard tier)

- Input features: log(1+|STFT|) \[257\], per-frame.
- Net: Linear(257→256) → GRU(256, 2 layers) → Linear(256→257) → sigmoid mask. ≈ 0.9 M params, \~3.6 MB fp32, \~1 MB int8.
- Alternative if quality plateaus: DTLN-style dual-stage; evaluate before committing.
- Loss: power-law compressed spectral loss (c=0.3, magnitude + complex) + multi-resolution STFT loss; optional SI-SDR term.
- **ONNX interface (contract):**

| Name | Shape | Dtype | Notes |
| --- | --- | --- | --- |
| `feat` (in) | `[1, T, 257]` | f32 | T dynamic (1 live, N file) |
| `h_in` (in) | `[2, 1, 256]` | f32 | zeros at start |
| `mask` (out) | `[1, T, 257]` | f32 | 0-1 |
| `h_out` (out) | `[2, 1, 256]` | f32 | feed back next call |

- **Parity test (CI gate):** PyTorch full-sequence output vs ONNX chunked (T=1) output max abs error \< 1e-4; vs int8 quantized, DNSMOS drop \< 0.05.

### 7.4 Hosting and Isolation

- Headers on every response: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`. Set in Vite dev/preview server and in production host config (`_headers` for Netlify/Cloudflare Pages, or server config).
- Consequences: third-party scripts, fonts, analytics, and images without `Cross-Origin-Resource-Policy` will break. **Self-host everything**; use privacy-friendly analytics only if same-origin.
- Runtime check: `self.crossOriginIsolated`. If false → single-thread WASM + MessagePort path.
- ORT config: `env.wasm.simd = true`; `env.wasm.numThreads = crossOriginIsolated ? Math.min(4, hardwareConcurrency) : 1`; WASM files served from same origin with correct MIME; pin onnxruntime-web version.

### 7.5 DSP Chain Order

`Input → (optional) HPF → inference → dry/wet mix (delay-aligned) → loudness gain → limiter → output` Loudness is measured on the mixed signal so the slider doesn't change perceived level.

### 7.6 Mic Capture Constraints

Request `getUserMedia({ audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 } })` so the model receives the signal it was trained on. Expose a "Browser processing" advanced toggle for devices where raw capture is too quiet.

---

## 8. Capability and Fallback Matrix

| Capability missing | Detection | Fallback |
| --- | --- | --- |
| Cross-origin isolation / SAB | `crossOriginIsolated` | Single-thread WASM; live mode via MessagePort ("Compatibility mode") |
| WASM SIMD | feature test | Non-SIMD ORT build, warn about speed |
| AudioWorklet | `window.AudioWorklet` | File mode only; live disabled |
| WebGPU | `navigator.gpu` | WASM CPU (default anyway) |
| Mic permission denied | promise rejection | Instructions + file mode |
| Slow device | first-run benchmark \< 1.5x real-time | Standard tier only, int8, shorter chunks |

---

## 9. Training Plan

**Data (commercial-friendly, tracked in `LICENSES.md`)**

- Clean speech: VCTK (CC BY 4.0), LibriTTS (CC BY 4.0), DNS Challenge clean subset (verify per-file license). Attribution page in app.
- Noise: DNS Challenge noise, MS-SNSD, FSD50K subset (check per-clip CC license; exclude NC). **Exclude UrbanSound8K (CC BY-NC).**
- Room impulse responses: openly licensed RIR sets (e.g. OpenAIR/ BUT ReverbDB; verify license).
- Ledger columns: dataset, version, license, commercial OK (Y/N), attribution text, download date, hash.

**Synthetic mixing (`augment.py`)**

- SNR uniform -5 to 25 dB; 20% reverb (RIR convolution, target remains early-reflection or dry per decision below); 10% clipping; 15% MP3/Opus codec round-trip; random EQ (±6 dB tilt, band-limit 4-8 kHz); gain -35 to -5 dBFS; 5% pure-noise / pure-speech samples.
- **Decision (open):** train target as dry speech (de-reverb) vs reverberant speech. Start with reverberant-target for stability; test de-reverb later.
- Fixed val/test split by speaker; never share speakers across splits.

**Training**

- 4 s random crops, batch 32-64, AdamW lr 1e-3 with cosine decay, grad clip 5, 100-200 epochs, AMP, fixed seeds, log with TensorBoard/W&B.
- Export best checkpoint by val DNSMOS, not loss.
- Hardware: single consumer GPU or free Colab/Kaggle tier is sufficient for \~1M params.

**Evaluation (`eval.py`)**

- Metrics: DNSMOS (SIG/BAK/OVRL), PESQ-WB, STOI, SI-SDR on held-out set; plus a fixed **regression clip set** (30 real noisy clips: cafe, fan, street, keyboard, reverb room, low-quality mic).
- Release gate: OVRL DNSMOS ≥ input + 0.5; no regression > 0.1 on regression set; blind A/B preference ≥ 70% (≥ 10 listeners).

---

## 10. Repository Structure

```
voice-enhancer/
├── ai-training/
│   ├── datasets/            # gitignored; scripts to fetch + hash
│   ├── LICENSES.md
│   ├── augment.py  model.py  train.py  eval.py
│   ├── export_onnx.py       # stateful I/O, dynamic T, parity test
│   └── quantize.py          # int8 dynamic quantization + DNSMOS check
├── web-app/
│   ├── public/  (model-standard.int8.onnx, ort-wasm/*, worklet-mic.js)
│   ├── src/
│   │   ├── workers/ worker-file.js  worker-live.js
│   │   ├── audio/   inference.js  stft.js  resample.js  hpf.js
│   │   │            ring-buffer.js  lufs.js  limiter.js  mixer.js
│   │   │            encode-wav.js  encode-mp3.js  capabilities.js
│   │   ├── components/ EnhancerUI.jsx  WaveformAB.jsx  Progress.jsx  Settings.jsx
│   │   └── App.jsx
│   ├── tests/ (unit, parity, e2e, fixtures/regression-clips)
│   ├── vite.config.js       # COOP/COEP headers
│   └── _headers             # production headers
└── docs/ PRD.md  ARCHITECTURE.md  MODEL_CARD.md
```

## 11. UI Spec

- Screens: Home (Upload / Record), Processing (progress, cancel, ETA), Result (A/B waveform, strength slider, preset chips, LUFS readout, export), Live (level meters in/out, latency readout, mute monitor, record, headphones warning), About (privacy, attributions).
- States: empty, loading model, processing, done, error, unsupported browser.
- Show model version and measured latency in Settings for debugging.

## 12. Testing Strategy

- **Unit:** STFT/ISTFT perfect reconstruction (\< -90 dB error with mask=1), resampler round-trip, LUFS vs reference vectors (EBU Tech 3341), limiter ceiling, ring buffer wraparound.
- **Parity:** PyTorch vs ONNX vs int8 (CI gate, section 7.3).
- **Integration:** file chunk boundaries inaudible (spectral discontinuity test); dry/wet null test.
- **E2E (Playwright):** upload → process → export on Chromium, Firefox, WebKit; network-block privacy test.
- **Live soak:** 30-min mic loop with synthetic input, count underruns (target \< 1 per 10 min).
- **Manual device matrix:** Windows/Mac Chrome, Firefox, Safari macOS/iOS, Android Chrome (low-end device).

## 13. Success Metrics

Quality (DNSMOS, preference), speed (≥ 3x real-time file mode), reliability (\< 5% failures), privacy (0 audio requests), live (latency ≤ 80 ms, \< 1 underrun/10 min).

---

## 14. Build Plan (milestones, tasks, exit criteria)

**M0: Foundations (days 1-3)** Vite+React scaffold; COOP/COEP headers and `crossOriginIsolated` check; CI with lint/unit; `LICENSES.md` started. *Exit:* page reports isolated = true locally and on staging host.

**M1: File pipeline with pre-trained model (weeks 1-2)** Decode, HPF, resample, STFT/ISTFT, ORT in Worker with a pre-trained ONNX/RNNoise-WASM stand-in, LUFS + limiter, WAV export, progress/cancel. *Exit:* mask=1 passthrough reconstructs input; 10-min file processed offline; LUFS ±0.5 LU.

**M2: UX and mixing (week 3)** A/B waveform, dry/wet with latency alignment, MP3 export, error states, capability fallbacks. *Exit:* null test passes; no comb filtering; works single-thread in Safari.

**M3: Data and training (weeks 4-6)** Download/hash datasets, augmentation, train baseline GRU, eval harness, regression set, iterate. *Exit:* OVRL DNSMOS ≥ input + 0.5 on test set; no regression-set failures.

**M4: Export and integrate (week 7)** Stateful ONNX export, parity tests, int8 quantization, swap into app, tune chunking. *Exit:* parity gates green; model ≤ 5 MB; file speed ≥ 3x real-time.

**M5: Live mode (weeks 8-9)** AudioWorklet I/O, ring buffers, inference worker loop, latency measurement, short-term loudness AGC, headphone protection, compatibility mode. *Exit:* 30-min soak with \< 3 underruns; latency ≤ 80 ms.

**M6: Hardening and launch (week 10)** Cross-browser matrix, accessibility audit, attribution page, model card, privacy test, performance pass. *Exit:* all release gates in section 9 and 13 met.

**Post-launch:** High-quality 48 kHz model, WebGPU path, de-reverb, de-essing, hum removal, PWA/offline.

---

## 15. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Artifacts ("underwater") on real recordings | Poor quality | Dry/wet slider, richer augmentation, regression set, loss tuning |
| Live underruns on weak CPUs | Glitches | Adaptive ring buffer, benchmark gating, auto-disable live |
| COEP breaks assets/embeds | Broken UI | Self-host everything; CI check for cross-origin loads |
| Safari/iOS quirks | Feature gaps | Early testing (M2), fallback modes, documented limits |
| Dataset license issues | Legal | Ledger, exclude NC, per-file checks, attribution page |
| Latency estimate wrong | Dry/wet comb filtering | Impulse-measured constant, test per model version |
| Quality ceiling of small model | Underwhelms vs commercial tools | Position as denoise+balance; plan High-quality tier |
| Memory on long files | Crashes | Chunked processing, streaming encode, cap file length |

## 16. Open Questions

1. Free tool or paid product (confirms dataset constraints)?
2. Reverberant vs dry training target?
3. Max file length and device floor for v1?
4. Is live mode required at launch or v1.1?
5. Hosting provider (must support custom headers)?
6. Analytics: none, or same-origin only?

## 17. Appendix: Key Snippets

**Vite headers**

```js
// vite.config.js
export default {
  server:  { headers: { 'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Embedder-Policy':'require-corp' } },
  preview: { headers: { 'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Embedder-Policy':'require-corp' } },
};
```

**Ring buffer control layout (Int32Array, 4 slots)** `[0]=writeIndex [1]=readIndex [2]=underrunCount [3]=overrunCount` (all via `Atomics.load/store`; capacity = power of two for cheap masking).

**Stateful export sketch**

```python
torch.onnx.export(
  model, (feat, h0), "model.onnx",
  input_names=["feat","h_in"], output_names=["mask","h_out"],
  dynamic_axes={"feat":{1:"T"}, "mask":{1:"T"}}, opset_version=17)
```