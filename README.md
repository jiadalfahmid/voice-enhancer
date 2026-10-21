# ClearVoice Studio

**ClearVoice Studio** is a professional, client-side web application for AI speech enhancement, dynamic vocal leveling, and audio mastering that runs **100% on-device** in modern web browsers.

[![CI](https://github.com/owner/clearvoice-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/owner/clearvoice-studio/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Privacy: 100% On-Device](https://img.shields.io/badge/Privacy-100%25%20On--Device-success.svg)](docs/PRIVACY.md)
[![Runtime: WebAssembly & ONNX](https://img.shields.io/badge/Runtime-WASM%20%7C%20ONNX%20Web-purple.svg)](docs/ARCHITECTURE.md)
[![Audio: EBU R128 Matched](https://img.shields.io/badge/Audio-EBU%20R128%20LUFS-orange.svg)](docs/ARCHITECTURE.md)

---

## 🚀 Live Demo

Experience ClearVoice Studio directly in your web browser:  
🔗 **[https://clearvoice-studio.pages.dev](https://clearvoice-studio.pages.dev)** *(Zero server uploads &bull; Works offline)*

---

## Table of Contents

- [Why ClearVoice Studio?](#-why-clearvoice-studio)
- [Key Features](#-key-features)
- [Speech Enhancement Model Catalog](#-speech-enhancement-model-catalog)
- [Mastering & DSP Architecture](#-mastering--dsp-architecture)
- [Privacy & Security Architecture](#-privacy--security-architecture)
- [Hardware & Browser Support](#-hardware--browser-support)
- [Local Development](#-local-development)
  - [Prerequisites](#prerequisites)
  - [Quickstart](#quickstart)
  - [Verification Suite](#verification-suite)
- [Free Cloud Deployment (Cloudflare Pages)](#-free-cloud-deployment-cloudflare-pages)
- [Repository Structure](#-repository-structure)
- [Attribution & Third-Party Licenses](#-attribution--third-party-licenses)
- [Contact](#-contact)
- [License](#-license)

---

## 💡 Why ClearVoice Studio?

Most AI speech enhancement tools (such as Adobe Podcast, Descript, or cloud speech APIs) require uploading raw voice recordings to remote cloud servers. This introduces:
- **Privacy & Compliance Violations**: Sensitive interviews, legal depositions, medical dictation, or personal calls are exposed to third-party infrastructure.
- **Network Latency & Bandwidth Bottlenecks**: Uploading large multi-track WAV or video files requires high-speed internet and sustained bandwidth.
- **Subscription Paywalls & Usage Limits**: Most cloud services impose monthly credit caps or minute-based pricing.

**ClearVoice Studio completely eliminates server dependencies.** By pairing WebAssembly SIMD and ONNX Runtime Web with dedicated Web Workers, the entire deep learning inference and mastering pipeline executes in your browser's local RAM. Audio files, waveforms, transcripts, and model weights **never leave your device**.

---

## ✨ Key Features

- **Four State-of-the-Art Neural Enhancement Engines**:
  - **GTCRN (16 kHz)**: Ultra-fast convolutional recurrent network (0.5 MB) providing rapid suppression of heavy background noise.
  - **DeepFilterNet3 (48 kHz)**: Full-band Rust WebAssembly engine with SIMD acceleration for natural podcast vocal preservation.
  - **DPDFNet 16 kHz & 48 kHz (ONNX)**: Dual-path recurrent networks operating with specialized Vorbis STFT transforms.
- **Fair Loudness-Matched A/B Auditioning**:
  - Instant 10 ms click-free crossfade between original and processed audio.
  - Automatic real-time loudness matching to **-20 LUFS**, ensuring comparisons are never skewed by volume differences.
  - Synchronized dual-waveform display with scrub bar and keyboard shortcuts (`Space` to Play/Pause, `A`/`B` to crossfade).
- **Studio Voice Polish Channel Strip**:
  - **Speech-Gated Dynamic Auto-Leveler**: Smooths phrase loudness variations without pumping room tone during speech pauses.
  - **5-Band Parametric Voice EQ**: Low-Cut High-Pass Filter (80 / 100 / 120 Hz), Warmth (220 Hz), De-Mud (600 Hz), Presence (3 kHz), and Air (10 kHz).
- **Non-Destructive Version History & Multi-Pass Workflow**:
  - The input recording is strictly immutable.
  - Run multi-pass enhancements across complementary models (e.g. GTCRN noise removal followed by DeepFilterNet3 acoustic smoothing).
- **Multi-Format Lossless & Compressed Export**:
  - Lossless 16-bit and 24-bit PCM WAV with -1 dBTP true-peak limiter protection.
  - High-quality MP3 export (128, 192, or 256 kbps) powered by `lamejs`.
- **External Model Comparator**:
  - Drag and drop audio processed by external software to audition it side by side with automatic duration, sample rate, and loudness alignment.

---

## 🔬 Speech Enhancement Model Catalog

All neural models are embedded and executed locally in client memory:

| Engine | Sample Rate | Binary Size | Runtime Engine | License | Primary Character &amp; Recommended Use |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **GTCRN** *(Recommended)* | 16 kHz | 0.5 MB | ONNX Web SIMD | MIT | Fastest real-time baseline; exceptional stationary & non-stationary noise removal; laptop/mobile efficient. |
| **DeepFilterNet3** | 48 kHz | 24.4 MB | Rust WASM SIMD | MIT / Apache-2.0 | Full-band studio quality; preserves natural vocal harmonics, room acoustic space, podcasts, and voiceovers. |
| **DPDFNet 16k** | 16 kHz | 8.4 MB | ONNX Web SIMD | Apache-2.0 | Recurrent dual-path model with 320-point Vorbis STFT for clean low-latency dialogue. |
| **DPDFNet 48k** | 48 kHz | 10.5 MB | ONNX Web SIMD | Apache-2.0 | Full-band 48 kHz recurrent dual-path model with 960-point Vorbis STFT for extended frequency range. |

---

## 🎛️ Mastering & DSP Architecture

```
[ Input Recording (WAV / MP3 / M4A / WebM / MP4) ]
                          │
                          ▼
            [ Web Audio Context Decoder ]
                          │
                          ▼
              [ Worker Thread Pipeline ]
                          │
    ┌─────────────────────┴─────────────────────┐
    ▼                                           ▼
[ Feature Extraction / STFT ]         [ Raw Dry Input Cache ]
    │                                           │
    ▼                                           │
[ Neural Inference (WASM / ONNX) ]              │
    │                                           │
    ▼                                           │
[ Inverse STFT Synthesis ]                      │
    │                                           │
    └─────────────────────┬─────────────────────┘
                          │
                          ▼
              [ Dry / Wet Mix Control ]
                          │
                          ▼
       [ Voice Polish: Speech-Gated Leveler ]
                          │
                          ▼
       [ Voice Polish: 5-Band Parametric EQ ]
                          │
                          ▼
      [ EBU R128 Loudness Normalizer & Limiter ]
                          │
                          ▼
         [ Interactive A/B Audio Canvas ]
```

### Voice Polish Channel Strip
1. **Speech-Gated Auto-Leveler**: Uses a short-time RMS envelope follower with an integrated speech threshold gate to adjust voice amplitude smoothly while preventing ambient noise pumping during breath pauses.
2. **Low-Cut High-Pass Filter (HPF)**: 2nd-order Butterworth biquad filter (80, 100, or 120 Hz) to eliminate mic stand thumps and plosive rumbles.
3. **Warmth Peak Filter (220 Hz)**: Peaking biquad filter ($\pm 6\text{ dB}$) that controls vocal body and chest resonance.
4. **De-Mud Peak Filter (600 Hz)**: Peaking biquad filter ($\pm 6\text{ dB}$) that attenuates boxy room reflections.
5. **Presence Peak Filter (3 kHz)**: Peaking biquad filter ($\pm 6\text{ dB}$) that enhances vocal articulation and intelligibility.
6. **Air High-Shelf Filter (10 kHz)**: High-shelf biquad filter ($\pm 6\text{ dB}$) providing broadcast sheen and openness.

---

## 🔒 Privacy & Security Architecture

ClearVoice Studio adheres to a strict zero-trust client model:

- **No Remote Telemetry**: Zero analytics, trackers, ads, or external telemetry scripts.
- **Strict Content Security Policy (CSP)**:
  ```http
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
  ```
  `connect-src 'self'` prevents the browser from transmitting data to external origins.
- **Cross-Origin Isolation**:
  ```http
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```
  Enables browser access to high-performance `SharedArrayBuffer` memory without cross-origin side-channel leaks.
- **Airplane Mode Ready**: Once the web application is loaded and models are cached by your browser, ClearVoice Studio functions entirely offline without an active internet connection.

Review the complete [Privacy Notice](docs/PRIVACY.md).

---

## 💻 Hardware & Browser Support

| Environment | Supported Browsers | Max Audio Duration | Recommended Hardware |
| :--- | :--- | :--- | :--- |
| **Desktop** (Windows, macOS, Linux) | Chrome &ge; 114, Edge &ge; 114, Firefox &ge; 115, Safari &ge; 16.4 | Up to 5 minutes (expandable to 30 min with &ge; 8 GB RAM) | &ge; 4 GB RAM, 64-bit CPU with SIMD |
| **Mobile** (Android, iOS) | Chrome for Android &ge; 114, Safari on iOS 16.4+ | 60 seconds | Single-model mode recommended |

> [!NOTE]
> ClearVoice Studio employs an LRU idle engine cache that automatically releases inactive WebAssembly heaps when switching models, preventing mobile memory exhaustion.

---

## 🛠️ Local Development

### Prerequisites
- **Node.js**: `v20.0.0` or higher
- **npm**: `v10.0.0` or higher

### Quickstart

```bash
# 1. Clone the repository
git clone https://github.com/jiadalfahmid/clearvoice-studio.git
cd clearvoice-studio/web-app

# 2. Install dependencies (automatically provisions ONNX Runtime Web binaries)
npm ci

# 3. Start local development server with cross-origin isolation
npm run dev
```

Visit `http://localhost:5173` in your browser.

### Verification Suite

```bash
# Run the complete test and type-checking suite
npm run check

# Sub-commands:
npm run typecheck:studio   # TypeScript compiler verification
npm test                   # Vitest unit test suite (20 files, 133 tests)
npm run test:studio        # Node test runner (coordinator, memory budget, engine warm pool)
npm run build              # Production bundle build with Vite
```

---

## 🌐 Free Cloud Deployment (Cloudflare Pages)

Because ClearVoice Studio is a static, client-side web application, you can deploy it globally for **free** with unlimited bandwidth.

### Method 1: Instant Drag & Drop (60 Seconds)
1. Run `npm run build` inside `web-app/` to create the `dist/` directory.
2. Sign up for a free account at [Cloudflare](https://dash.cloudflare.com/).
3. In the dashboard, navigate to **Workers & Pages** &rarr; **Create application** &rarr; **Pages** &rarr; **Upload assets**.
4. Name your project (e.g. `clearvoice-studio`).
5. Drag and drop the `web-app/dist` folder into the upload box and click **Deploy Site**.
6. Your studio is instantly live at `https://<your-project>.pages.dev` with automatic SSL and multi-threading headers.

### Method 2: Continuous Deployment via GitHub
1. Push this repository to your GitHub account:
   ```bash
   git remote add origin https://github.com/jiadalfahmid/clearvoice-studio.git
   git push -u origin master
   ```
2. In the [Cloudflare Dashboard](https://dash.cloudflare.com/), go to **Workers & Pages** &rarr; **Create application** &rarr; **Pages** &rarr; **Connect to Git**.
3. Select your repository and configure the build settings:
   - **Framework preset**: `Vite`
   - **Root directory**: `web-app`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Click **Save and Deploy**. Cloudflare will automatically build and publish any future commits.

---

## 📂 Repository Structure

```text
clearvoice-studio/
├── .github/workflows/ci.yml       # GitHub Actions CI matrix (Node 20 & 22)
├── docs/
│   ├── ARCHITECTURE.md            # Deep technical & mathematical documentation
│   ├── BASELINE.md                # Objective speech quality benchmarks
│   ├── MODEL_INTEGRATION.md       # Guide for training & adding custom models
│   ├── PRD.md                     # Product Requirements Document
│   ├── PRIVACY.md                 # Verbatim privacy policy
│   └── USER_MANUAL.md             # In-depth user manual
├── ai-training/                   # Offline model training & evaluation scripts
├── colab/                         # Google Colab notebooks for candidate benchmarking
├── kaggle/                        # Kaggle model training notebook
├── LICENSE                        # Project MIT License
├── README.md                      # Primary documentation
└── web-app/
    ├── e2e/                       # Playwright browser end-to-end smoke tests
    ├── public/
    │   ├── _headers               # Cloudflare Pages security & caching headers
    │   ├── licenses/              # Verbatim third-party licenses
    │   ├── models/                # Local ONNX and WASM model binaries
    │   ├── privacy.html           # Standalone offline privacy policy page
    │   └── THIRD-PARTY-NOTICES.txt# Comprehensive software attributions
    ├── src/
    │   ├── audio/                 # Audio DSP (resampling, STFT, EQ, balancer, LUFS)
    │   ├── components/            # React workstation UI components
    │   ├── studio/                # Studio state coordinator & engine rules
    │   ├── workers/               # Dedicated Web Worker inference pipelines
    │   └── studio.css             # Workstation dark theme & grid system
    └── tests/                     # Unit and integration test suites
```

---

## 📜 Attribution & Third-Party Licenses

ClearVoice Studio incorporates open-source architectures, model weights, and software libraries under permissive licenses:

- **DeepFilterNet3**: Dual-licensed under MIT / Apache-2.0 &bull; [Rloger / Hendrik Schröter](https://github.com/Rikorose/DeepFilterNet)
- **GTCRN**: MIT License &bull; [Xiaobin Rong](https://github.com/alibabaspeech/GTCRN)
- **DPDFNet**: Apache-2.0 License &bull; [Ceva-IP](https://huggingface.co/Ceva-IP/DPDFNet)
- **ONNX Runtime Web**: MIT License &bull; [Microsoft Corporation](https://github.com/microsoft/onnxruntime)
- **lamejs**: LGPL-3.0 License &bull; [BreezyStack](https://github.com/breezystack/lamejs)
- **React**: MIT License &bull; [Meta Platforms, Inc.](https://github.com/facebook/react)

Complete attribution statements and license texts are cataloged in [`web-app/public/THIRD-PARTY-NOTICES.txt`](web-app/public/THIRD-PARTY-NOTICES.txt) and individual files under [`web-app/public/licenses/`](web-app/public/licenses/).

---

## 👤 Contact

Project Maintainer & Lead Developer:  
**Jiad Al Fahmid**  
📧 Email: [jiadalfahmid@gmail.com](mailto:jiadalfahmid@gmail.com)  
🌐 GitHub: [@jiadalfahmid](https://github.com/jiadalfahmid)

---

## ⚖️ License

ClearVoice Studio application source code is licensed under the [MIT License](LICENSE).

