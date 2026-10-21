# ClearVoice Studio

**ClearVoice Studio** is a private, client-side web application for AI speech enhancement, dynamic vocal leveling, and audio mastering that runs 100% on-device in your web browser.

[![CI](https://github.com/owner/clearvoice-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/owner/clearvoice-studio/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Privacy: 100% On-Device](https://img.shields.io/badge/Privacy-100%25%20On--Device-success.svg)](docs/PRIVACY.md)

---

## Live Demo

🚀 **Try ClearVoice Studio in your browser**: [https://clearvoice-studio.pages.dev](https://clearvoice-studio.pages.dev) *(Cloudflare Pages deployment)*

---

## Key Features

- **Four State-of-the-Art Speech Enhancement Models**:
  - **DeepFilterNet3 (48 kHz)**: Native Rust WebAssembly with SIMD acceleration for full-band podcast dialogue and broadcast voiceovers.
  - **GTCRN (16 kHz)**: Ultra-compact (1.3 MB) convolutional recurrent network for fast, aggressive background noise removal.
  - **DPDFNet 48 kHz (ONNX)**: Dual-path recurrent network operating at 48 kHz with custom mixed-radix STFT.
  - **DPDFNet 16 kHz (ONNX)**: Lightweight dual-path model optimized for low-latency dialogue.
- **Fair A/B Comparison Player**:
  - Instant 10 ms click-free crossfade between original and processed audio.
  - Automatic real-time loudness matching to -20 LUFS to eliminate the psychoacoustic volume bias.
  - Synchronized dual-waveform display with interactive seek bar and keyboard shortcuts (`Space` to Play/Pause, `A`/`B` to switch).
- **Studio Voice Polish**:
  - **Speech-Gated Dynamic Leveler (Voice Balancer)**: Automatically smooths phrase loudness variations without pumping room noise during vocal pauses.
  - **5-Band Parametric Voice Equalizer**: High-pass filter, warmth, de-mud, presence, and air shaping with five voice-tailored presets.
- **Non-Destructive Version History**:
  - Original recording is strictly immutable.
  - Run multi-pass enhancements or compare different model outputs side-by-side.
- **Flexible Export**:
  - Lossless 16-bit and 24-bit PCM WAV with -1 dBTP true-peak limiter protection.
  - High-quality MP3 export (128, 192, or 256 kbps) powered by `lamejs`.
- **External Comparator**:
  - Drag and drop audio processed in external desktop tools (e.g. Resemble Enhance, Adobe Podcast) to compare directly against browser models with automatic duration and sample-rate alignment.

---

## 100% Private &amp; Offline-Capable

ClearVoice Studio is built on a zero-server-trust architecture:

- **No Uploads**: Audio files, transcripts, waveforms, and processing NEVER leave your computer or phone.
- **Zero Third-Party Requests**: The app makes no calls to analytics servers, external APIs, or tracking pixels.
- **Airplane Mode Ready**: Once cached in your browser, ClearVoice Studio functions entirely offline without an active internet connection.

Read our complete [Privacy Notice](docs/PRIVACY.md).

---

## Browser Support &amp; System Limits

| Platform | Recommended Browsers | Maximum File Duration | Memory Recommendation |
| :--- | :--- | :--- | :--- |
| **Desktop** (Windows, macOS, Linux) | Chrome &ge; 114, Edge &ge; 114, Firefox &ge; 115, Safari &ge; 16.4 | Up to 5 minutes (expandable to 30 min with &ge; 8 GB RAM) | &ge; 4 GB RAM |
| **Mobile** (Android, iOS) | Chrome for Android, Safari on iOS 16.4+ | 60 seconds | Single-model mode recommended |

> [!NOTE]
> ClearVoice Studio automatically disposes idle model memory heaps when switching engines to prevent mobile browser tab crashes.

---

## Developer Guide

### Prerequisites

- Node.js &ge; 20.0.0
- npm &ge; 10.0.0

### Quickstart

```bash
# Clone the repository
git clone https://github.com/owner/clearvoice-studio.git
cd clearvoice-studio/web-app

# Install dependencies (copies ONNX Runtime Web binaries to public/ort)
npm ci

# Start local development server with COOP/COEP isolation
npm run dev

# Run automated tests
npm test                  # Vitest unit test suite (20 suites, 133 tests)
npm run test:studio       # Studio coordinator & lifecycle tests
npm run typecheck:studio  # TypeScript verification

# Build for production
npm run build
```

---

## Technical Architecture

Detailed architectural breakdowns, mathematical formulations, DSP biquad filter designs, and worker threading pipelines are documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Additional documentation:
- [User Manual &amp; Benchmarks](docs/USER_MANUAL.md)
- [Privacy Policy](docs/PRIVACY.md)
- [Model Integration Guide](docs/MODEL_INTEGRATION.md)

---

## Model Attribution &amp; Licenses

ClearVoice Studio incorporates open-source model architectures and weights under permissive licenses:

- **DeepFilterNet3**: Dual-licensed under MIT / Apache-2.0 (Rloger / Hendrik Schröter).
- **GTCRN**: MIT License (Xiaobin Rong).
- **DPDFNet**: Apache-2.0 License.
- **ONNX Runtime Web**: MIT License (Microsoft Corporation).
- **lamejs**: LGPL-3.0 License.

Complete third-party notices, verbatim license texts, and upstream source repositories are detailed in [`web-app/public/THIRD-PARTY-NOTICES.txt`](web-app/public/THIRD-PARTY-NOTICES.txt) and individual texts under [`web-app/public/licenses/`](web-app/public/licenses/).

---

## License

This project is licensed under the [MIT License](LICENSE).
