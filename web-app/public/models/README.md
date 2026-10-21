# ClearVoice Studio Model Artifacts

This directory contains the AI model binaries and WebAssembly engines shipped with ClearVoice Studio.
All models run 100% locally on-device inside client Web Workers.

---

### 1. gtcrn_simple.onnx
- **What**: GTCRN streaming speech enhancer, 16 kHz, FFT 512 / hop 256 / sqrt-Hann, caches fed back per frame.
- **Upstream URL**: https://github.com/Xiaobin-Rong/gtcrn (`stream/onnx_models/gtcrn_simple.onnx`)
- **Revision / Commit**: `3862c44808dca492ea5a8a145d2dc2a1028d08c8`
- **SHA-256**: `b4718df6228e7bdf1a8a435cf98f838636eb2fd331acabf86ba87c5192ebcb87`
- **Size**: 535,190 bytes (approx 0.5 MB)
- **License**: MIT
- **Training Data Note**: Trained on DNS Challenge datasets. TODO(owner): confirm commercial suitability of DNS Challenge audio.
- **Date Downloaded**: 2026-10-09

---

### 2. dpdfnet_baseline.onnx (16 kHz)
- **What**: DPDFNet 16 kHz recurrent dual-path speech enhancement model with 320-point Vorbis STFT and 38,256 recurrent states.
- **Upstream URL**: https://huggingface.co/Ceva-IP/DPDFNet and https://github.com/ceva-ip/DPDFNet
- **Revision / Commit**: `main` (arXiv:2512.16420)
- **SHA-256**: `debaf0e8893479fca91b8b4c1eae8db195aa8980ccc9012f5809fde2b738151a`
- **Size**: 8,791,035 bytes (approx 8.4 MB)
- **License**: Apache-2.0
- **Training Data Note**: Trained on VoiceBank-DEMAND / DNS Challenge subsets.
- **Date Downloaded**: 2026-10-19

---

### 3. dpdfnet_48k.onnx (48 kHz)
- **What**: DPDFNet 48 kHz full-band recurrent dual-path speech enhancement model with 960-point Vorbis STFT and 56,436 recurrent states.
- **Upstream URL**: https://huggingface.co/Ceva-IP/DPDFNet and https://github.com/ceva-ip/DPDFNet
- **Revision / Commit**: `main` (arXiv:2512.16420)
- **SHA-256**: `7f0575a5cec0ba4ffd8f8bd657e06d007e4ccdd955d76faab922b9d3291dc14b`
- **Size**: 10,493,337 bytes (approx 10.5 MB)
- **License**: Apache-2.0
- **Training Data Note**: Trained on multi-speaker full-band speech corpora.
- **Date Downloaded**: 2026-10-21

---

### 4. deepfilternet3/df_bg.wasm
- **What**: WebAssembly engine runtime compiled from DeepFilterNet Rust crate `libDF` using wasm-bindgen.
- **Upstream URL**: https://github.com/Rikorose/DeepFilterNet
- **SHA-256**: `440b5d12b6ea7d95008736f844221d7874ee15de5cb10d3015002470fdba0432`
- **Size**: 16,418,651 bytes (approx 16.4 MB)
- **License**: MIT OR Apache-2.0
- **Provenance**: wasm-bindgen build of DeepFilterNet libDF. TODO(owner): document exact build environment and git commit tag.
- **Date Downloaded**: 2026-10-21

---

### 5. deepfilternet3/DeepFilterNet3_onnx.bin
- **What**: DeepFilterNet3 ONNX weights archive (ERB and DF stages) loaded by df_bg.wasm.
- **Upstream URL**: https://github.com/Rikorose/DeepFilterNet/releases/tag/v0.5.6 (`DeepFilterNet3_onnx.tar.gz`)
- **Revision / Commit**: Release `v0.5.6`
- **SHA-256**: `c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616`
- **Size**: 7,983,136 bytes (approx 8.0 MB)
- **License**: MIT OR Apache-2.0
- **Training Data Note**: Trained on DeepFilterNet synthetic speech/noise dataset (DNS4, Common Voice, AudioSet).
- **Date Downloaded**: 2026-10-21
