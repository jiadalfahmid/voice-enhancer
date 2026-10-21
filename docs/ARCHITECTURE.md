# ClearVoice Studio — Technical Architecture & System Design

**ClearVoice Studio** is a client-side, privacy-first web application for AI speech enhancement, dynamic voice leveling, and audio mastering. Everything runs 100% on-device in the browser using WebAssembly, SIMD, and ONNX Runtime Web—no user audio or data is ever uploaded to external servers.

---

## 1. System Overview

| Attribute | Details |
| :--- | :--- |
| **Project Name** | ClearVoice Studio |
| **Runtime Environment** | In-Browser Client (Chromium, Edge, Firefox, Safari) |
| **Core Technologies** | React 18, Vite 5, Web Workers, WASM SIMD, ONNX Runtime Web (`onnxruntime-web` 1.22.0) |
| **Privacy Guarantee** | 100% On-Device / Zero Cloud Uploads / Full Offline Capability |
| **Audio Processing Models** | DeepFilterNet3 (48 kHz WASM), DPDFNet 48 kHz (ONNX), DPDFNet 16 kHz (ONNX), GTCRN (16 kHz ONNX) |
| **Audio Mastering Tools** | Speech-Gated Voice Balancer, 5-Band Parametric Voice Equalizer |
| **Evaluation & Comparison** | Dual-track A/B Player with 10 ms seamless crossfading & -20 LUFS loudness matching |
| **Test Verification** | 20 Vitest suites (133 tests passed), 22 Studio Node tests passed, 0 TypeScript errors |

---

## 2. Speech Enhancement Engines

All AI models in ClearVoice Studio run directly in browser Web Workers to ensure an uninterrupted, stutter-free user interface:

### 1. DeepFilterNet3 (48 kHz WASM)
- **Architecture**: Deep filtering speech enhancement network operating at full-band 48 kHz.
- **Runtime**: Native Rust WebAssembly (`df_bg.wasm`) with SIMD acceleration.
- **Weights Artifact**: `DeepFilterNet3_onnx.bin` (~8.5 MB).
- **Best For**: High-fidelity podcast dialogue, broadcast speech, and full-spectrum noise removal without high-frequency band loss.

### 2. DPDFNet 48 kHz (ONNX)
- **Architecture**: Recurrent dual-path network with 960-point Vorbis window STFT, 481 frequency bins, and 480-sample hop.
- **DSP Engine**: Custom in-browser mixed-radix $3 \times 320$ Cooley-Tukey FFT/IFFT with 1920-sample lookahead delay compensation.
- **Hidden State**: 56,436-element continuous state carried across frames with ERB and spectral normalization metadata.
- **Model Size**: `dpdfnet_48k.onnx` (~2.3 MB).
- **Best For**: Studio recordings, complex background environments, and natural voice preservation at 48 kHz.

### 3. DPDFNet 16 kHz (ONNX)
- **Architecture**: Recurrent dual-path network with 320-point Vorbis window STFT, 161 frequency bins, and 160-sample hop.
- **Hidden State**: 38,256-element recurrent state vector.
- **Model Size**: `dpdfnet_baseline.onnx` (~1.2 MB).
- **Best For**: Fast, robust dialogue cleaning on lightweight or mobile devices.

### 4. GTCRN 16 kHz (ONNX Baseline)
- **Architecture**: Convolutional recurrent network operating on 16 kHz STFT spectra (512-point FFT, 256-sample hop).
- **Model Size**: `gtcrn_simple.onnx` (~1.3 MB).
- **Best For**: Ultra-low latency, low-resource devices, and heavy background noise suppression.

---

## 3. Voice Mastering & DSP Pipeline

In addition to neural noise reduction, ClearVoice Studio provides studio-grade voice polish tools designed specifically for spoken word:

### Voice Balancer (Dynamic Speech Leveler)
- **Speech-Gated Energy Detection**: Computes RMS energy over 50 ms frames with 25 ms hops.
- **Anti-Pumping Protection**: Audio below the gate threshold ($-42\text{ dBFS}$) is identified as pause/silence. During pauses, the target gain relaxes toward unity ($0\text{ dB}$), ensuring room ambience and background noise are **never** amplified.
- **Dynamic Leveling**: Levels quiet speech upward (up to $+8\text{ dB}$) and attenuates sudden loud bursts (down to $-8\text{ dB}$) toward the target dialogue level ($-20\text{ dBFS}$).
- **Dual-rate Ballistics**: Fast attack ($100\text{ ms}$) prevents transient spikes; gentle release ($600\text{ ms}$) provides natural dialogue smoothing.
- **Asynchronous Execution**: Processes in non-blocking chunks yielding to the event loop, supporting progress updates and user cancellation.

### 5-Band Parametric Voice Equalizer
Implemented using Robert Bristow-Johnson (RBJ) Audio EQ Cookbook biquad filters:
1. **Low-Cut (HPF)**: 2nd-order Butterworth filter ($80\text{ Hz}$ / $100\text{ Hz}$ / $120\text{ Hz}$) to remove desk thumps, AC hum, and plosive pops.
2. **Warmth / Body**: $220\text{ Hz}$ peaking filter ($Q=0.8$, $\pm 6\text{ dB}$) for chest resonance.
3. **De-Mud / Clarity**: $600\text{ Hz}$ peaking filter ($Q=1.0$, $\pm 6\text{ dB}$) to eliminate boxy room resonances.
4. **Presence / Articulation**: $3000\text{ Hz}$ peaking filter ($Q=1.0$, $\pm 6\text{ dB}$) for speech intelligibility and consonant crispness.
5. **Air / Sheen**: $10000\text{ Hz}$ high-shelf filter ($Q=0.7$, $\pm 6\text{ dB}$) for open vocal sparkle.
- **Nyquist Safety Clamping**: Filters auto-clamp frequencies to $\le 0.45 \times f_s$, ensuring stability across $16\text{ kHz}$ and $48\text{ kHz}$ audio.
- **Presets**: *Podcast / Broadcast*, *Crisp & Modern*, *Warm & Intimate*, *De-Box Mud*, and *Flat*.

---

## 4. Studio Architecture & Workflow

1. **Non-Destructive Version Tree (`VersionStore`)**:
   - The original recording is strictly immutable.
   - Every enhancement, second pass, or voice polish pass generates a new stage (`Original` $\to$ `Stage 1` $\to$ `Stage 2`).
   - Lineage is tracked; users can discard intermediate steps or export at any stage.
2. **Job Coordinator & Worker Lifecycle (`JobCoordinator`)**:
   - Manages model queuing with concurrency limits based on device memory.
   - **Idle Engine Disposal**: Disposes idle model WebAssembly and ONNX Runtime heaps when switching engines, keeping only the most recently active engine warm to prevent memory exhaustion on mobile browsers.
3. **Fair A/B Comparison Player (`ABPlayer` & `CompareView`)**:
   - **Equal-Loudness Normalization**: Both sides of the A/B comparison are matched to $-20\text{ LUFS}$ in real time to eliminate the "louder sounds better" psychoacoustic bias.
   - **Lockstep Playback & 10 ms Crossfade**: Dual gain nodes allow instantaneous switching between Version A and Version B without dropouts, clicks, or phase disorientation.
   - **Synchronized Canvas Waveform**: Dual-colored visual display with interactive seek head.
   - **Keyboard Shortcuts**: `Space` to Play/Pause, `A` / `B` to switch tracks instantly.
4. **Multi-Format Export (WAV & MP3)**:
   - **Lossless WAV**: 16-bit and 24-bit PCM WAV formats with true-peak limiter protection (ceil: -1 dBTP).
   - **MP3 Export**: In-browser MP3 encoding powered by `lamejs` with selectable bitrates: 128 kbps (compact), 192 kbps (standard), and 256 kbps (high quality).
5. **External Result Comparator**:
   - Allows dropping external results (e.g. processed by offline tools) directly into the Studio to A/B test against browser models with automatic duration, sample rate, and loudness alignment.

---

## 5. Security & Isolation

- **Cross-Origin Opener Policy (COOP)**: `same-origin`
- **Cross-Origin Embedder Policy (COEP)**: `require-corp`
- **Cross-Origin Resource Policy (CORP)**: `same-origin`
- **Content Security Policy (CSP)**: Disallows external network calls; restricts script and worker execution to `'self'` and `'wasm-unsafe-eval'`.
- Enables high-performance multi-threaded WebAssembly with `SharedArrayBuffer` where supported, while falling back gracefully to single-threaded execution.
