# ClearVoice Studio: User Manual

### What It Does
Cleans up speech recordings (removes background noise, room reverb, and mic hiss) with open AI models that run directly on your own device. Your files are never uploaded to any server.

---

### Quick Start (2 Minutes)
1. **Load Recording**: Drop an audio or video file onto the input box, or click to choose one (supports WAV, MP3, M4A, OGG, WebM, MP4).
2. **Enhance**: Click **"Enhance Original"** next to an AI model. The first time you use a model, it downloads once into your browser cache (0.5 to 25 MB).
3. **Compare**: The original recording is assigned to **A** and your enhanced result is assigned to **B**. Press **Play**, then seamlessly toggle between A and B (keyboard shortcuts: **A** and **B**, **Space** to play/pause). Both versions are automatically loudness-matched to -20 LUFS so volume differences never mislead your ears.
4. **Export**: Choose your desired format (WAV 16-bit, WAV 24-bit, or MP3) and click **Download**.

---

### Choosing a Model

| Model | Sample Rate | Download | Notes |
| :--- | :--- | :--- | :--- |
| **GTCRN** | 16 kHz | 0.5 MB | Smallest and fastest. Removes steady background noise with ultra-low compute; best first try on mobile. |
| **DPDFNet 16 kHz** | 16 kHz | 8.4 MB | Recurrent dual-path network. Balances noise reduction with natural speech intelligibility at 16 kHz. |
| **DPDFNet 48 kHz** | 48 kHz | 10.5 MB | Full-band dual-path network. Preserves full 48 kHz frequency spectrum with Vorbis STFT and recurrent state carry. |
| **DeepFilterNet3** | 48 kHz | 24.4 MB | High-fidelity deep filtering engine in Rust/WASM with SIMD. Excellent for podcast dialogue and full acoustic bandwidth. |

*Tip: Different microphones, voices, and noise profiles react differently to each model. Try two models on the same clip and compare them side by side.*

---

### Comparing Versions
Every enhancement pass creates a new version; your original recording is **strictly immutable** and never modified or overwritten.
In the Compare panel, pick any two versions (Version A and Version B) to audition them in lockstep.
- The player loops a 20-second preview window. Drag the slider to listen to different sections of the recording.
- **Shortcuts**: `Space` = Play / Pause, `A` = Switch to Track A, `B` = Switch to Track B.

---

### Enhance Again (Second Pass)
Runs an AI model on an existing result. A second pass is never run automatically.
*Caution: Stacking multiple passes can introduce artifacts or robotic timbre. Always A/B compare Stage 2 against Stage 1 before keeping it. Using the same model twice in a row rarely helps.*

---

### Voice Polish (EQ and Leveler)
Applies professional voice mastering directly to any version:
- **Speech-Gated Leveler**: Smooths out volume variations between quiet words and loud phrases without noise pumping during pauses (Strength 10% to 100%).
- **5-Band Voice Equalizer**:
  - **Low-Cut (HPF)**: Off, 80 Hz, 100 Hz, 120 Hz (cuts desk thumps and plosives).
  - **Warmth (220 Hz)**: Adjusts chest resonance and proximity boom ($\pm 6\text{ dB}$).
  - **De-Mud (600 Hz)**: Cleans out hollow, boxy room resonance ($\pm 6\text{ dB}$).
  - **Presence (3 kHz)**: Enhances vocal articulation and clarity ($\pm 6\text{ dB}$).
  - **Air (10 kHz)**: High-frequency sheen and openness ($\pm 6\text{ dB}$).
- **Presets**: *Podcast / Broadcast*, *Crisp & Modern*, *Warm & Intimate*, *De-Box Mud*, and *Flat*.

---

### Exporting Audio
- **16-bit WAV**: Industry-standard uncompressed CD quality.
- **24-bit WAV**: Studio-grade high dynamic range.
- **MP3 (128, 192, 256 kbps)**: Compressed format for sharing and web streaming.
All exported files are normalized to approximately -16 LUFS with true-peak safety limiting to prevent digital clipping.

---

### Adding an External Audio Result
If you processed a clip offline with an external tool (such as a local script), use **"Add External Audio Result"**. The studio automatically aligns its sample rate, channel count, and length, and loudness-matches it to -20 LUFS so you can A/B test it alongside browser models.

---

### Hardware Limits & Performance
- Files up to **10 minutes** on mobile devices and **30 minutes** on computers with 8 GB+ RAM.
- Audio versions are held in browser memory for fast instant comparison. If memory fills up, discard versions you no longer need.

---

### Troubleshooting
- **"Browser not supported"**: Use a current release of Google Chrome, Microsoft Edge, Mozilla Firefox, or Apple Safari.
- **File will not open**: Some legacy proprietary codecs (e.g. WMA, AMR) cannot be decoded natively by browsers. Convert to WAV or MP3 first.
- **Out of memory or page reload**: Close other browser tabs, use a shorter clip, or discard unused intermediate versions.
- **First run is slow**: The model weights are downloading over the network. Once cached, subsequent runs start immediately.
