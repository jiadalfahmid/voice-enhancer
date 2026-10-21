import React from 'react';

export default function HelpView({ onBack }) {
  return (
    <main className="studio help-view" style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1.25rem 4rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <a
            href="#"
            onClick={(e) => {
              if (onBack) {
                e.preventDefault();
                onBack();
              }
            }}
            className="btn-secondary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.88rem' }}
          >
            &larr; Back to Studio
          </a>
        </div>
        <div className="privacy-badge">
          <span className="privacy-pulse" aria-hidden="true" />
          <span>100% Private &bull; Runs Offline</span>
        </div>
      </div>

      <header style={{ marginBottom: '2rem', borderBottom: '1px solid var(--line)', paddingBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '2rem', margin: '0 0 0.5rem', color: 'var(--ink)' }}>ClearVoice Studio User Manual</h1>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '1rem' }}>
          Complete guide to on-device neural enhancement engines, mastering tools, hardware performance, and offline privacy.
        </p>
      </header>

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>1. Quickstart (2-Minute Workflow)</h2>
        <ol style={{ paddingLeft: '1.25rem', lineHeight: '1.7', color: 'var(--ink-secondary)' }}>
          <li>
            <strong>Import audio:</strong> Drag and drop a recording (WAV, MP3, M4A, OGG, WebM, MP4) into the drop zone.
          </li>
          <li>
            <strong>Select an engine:</strong> Click <em>Enhance Original</em> on any available model. For voiceovers and podcasts, <strong>DeepFilterNet3</strong> (48 kHz full-band) or <strong>GTCRN</strong> (16 kHz baseline) are recommended starting points.
          </li>
          <li>
            <strong>Audition &amp; Compare:</strong> Use the interactive A/B comparison player to switch between original and enhanced audio with instant 10 ms seamless crossfades. Both versions are loudness-matched to -20 LUFS.
          </li>
          <li>
            <strong>Voice Polish:</strong> Apply the mastering chain (speech-gated auto-leveler + 5-band parametric voice EQ) for professional broadcast warmth and presence.
          </li>
          <li>
            <strong>Export:</strong> Download your result as 16-bit WAV (lossless), 24-bit WAV (studio), or MP3 (128&ndash;256 kbps).
          </li>
        </ol>
      </section>

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>2. Speech Enhancement Model Catalog</h2>
        <p style={{ color: 'var(--muted)' }}>
          All engines execute 100% on-device using WebAssembly SIMD and ONNX Runtime Web. Memory footprint and sample rate specifications are verified directly from engine weights.
        </p>
        <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--line)', color: 'var(--ink)' }}>
                <th style={{ padding: '10px 8px' }}>Model</th>
                <th style={{ padding: '10px 8px' }}>Sample Rate</th>
                <th style={{ padding: '10px 8px' }}>Size</th>
                <th style={{ padding: '10px 8px' }}>Runtime</th>
                <th style={{ padding: '10px 8px' }}>License</th>
                <th style={{ padding: '10px 8px' }}>Best Suited For</th>
              </tr>
            </thead>
            <tbody style={{ color: 'var(--ink-secondary)' }}>
              <tr style={{ borderBottom: '1px solid var(--line-light)' }}>
                <td style={{ padding: '10px 8px', fontWeight: 600, color: 'var(--ink)' }}>GTCRN</td>
                <td style={{ padding: '10px 8px' }}>16 kHz</td>
                <td style={{ padding: '10px 8px' }}>0.5 MB</td>
                <td style={{ padding: '10px 8px' }}>ONNX Web SIMD</td>
                <td style={{ padding: '10px 8px' }}>MIT</td>
                <td style={{ padding: '10px 8px' }}>Fastest baseline; laptop/mobile efficiency, heavy noise suppression</td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--line-light)' }}>
                <td style={{ padding: '10px 8px', fontWeight: 600, color: 'var(--ink)' }}>DeepFilterNet3</td>
                <td style={{ padding: '10px 8px' }}>48 kHz</td>
                <td style={{ padding: '10px 8px' }}>24.4 MB</td>
                <td style={{ padding: '10px 8px' }}>WASM SIMD</td>
                <td style={{ padding: '10px 8px' }}>MIT / Apache-2.0</td>
                <td style={{ padding: '10px 8px' }}>Full-band studio voiceovers, podcasts, high-fidelity acoustic preservation</td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--line-light)' }}>
                <td style={{ padding: '10px 8px', fontWeight: 600, color: 'var(--ink)' }}>DPDFNet 16 kHz</td>
                <td style={{ padding: '10px 8px' }}>16 kHz</td>
                <td style={{ padding: '10px 8px' }}>8.4 MB</td>
                <td style={{ padding: '10px 8px' }}>ONNX Web SIMD</td>
                <td style={{ padding: '10px 8px' }}>Apache-2.0</td>
                <td style={{ padding: '10px 8px' }}>Recurrent dual-path filtering with 320-point Vorbis STFT</td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--line-light)' }}>
                <td style={{ padding: '10px 8px', fontWeight: 600, color: 'var(--ink)' }}>DPDFNet 48 kHz</td>
                <td style={{ padding: '10px 8px' }}>48 kHz</td>
                <td style={{ padding: '10px 8px' }}>10.5 MB</td>
                <td style={{ padding: '10px 8px' }}>ONNX Web SIMD</td>
                <td style={{ padding: '10px 8px' }}>Apache-2.0</td>
                <td style={{ padding: '10px 8px' }}>Full-band 48 kHz recurrent dual-path filtering with 960-point Vorbis STFT</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>3. Device Limits &amp; Performance Guidelines</h2>
        <ul style={{ paddingLeft: '1.25rem', lineHeight: '1.7', color: 'var(--ink-secondary)' }}>
          <li>
            <strong>Duration limits:</strong> Up to 5 minutes on desktop browsers with &ge; 4 GB RAM; automatically scaled down on low-memory mobile devices to prevent tab crashes.
          </li>
          <li>
            <strong>Supported Formats:</strong> WAV (PCM 16/24/32-bit), MP3, M4A/AAC, OGG (Vorbis/Opus), WebM, and MP4 video audio tracks.
          </li>
          <li>
            <strong>Hardware Acceleration:</strong> WebAssembly SIMD and WebGPU (when available) are utilized automatically for real-time acceleration.
          </li>
          <li>
            <strong>Memory Management:</strong> ClearVoice Studio uses an LRU idle engine cache, preserving warm model weights while releasing inactive engine memory to keep system usage lean.
          </li>
        </ul>
      </section>

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>4. Second-Pass &amp; Voice Polish DSP</h2>
        <p style={{ color: 'var(--ink-secondary)', lineHeight: '1.6' }}>
          <strong>Second Pass:</strong> You can run an enhanced output through another engine (for instance, running GTCRN to strip heavy background noise followed by DeepFilterNet3 for acoustic smoothing). Running the same model consecutively is warned against to prevent speech harmonic distortion.
        </p>
        <p style={{ color: 'var(--ink-secondary)', lineHeight: '1.6' }}>
          <strong>Voice Polish Channel Strip:</strong> Professional parametric DSP mastering chain:
        </p>
        <ul style={{ paddingLeft: '1.25rem', lineHeight: '1.6', color: 'var(--muted)' }}>
          <li><strong style={{ color: 'var(--ink)' }}>Speech-Gated Auto-Leveler:</strong> Short-time RMS envelope follower that evens out soft and loud phrases without noise-pumping during silence pauses.</li>
          <li><strong style={{ color: 'var(--ink)' }}>Low-Cut HPF (80 / 100 / 120 Hz):</strong> 2nd-order Butterworth biquad highpass filter to eliminate microphone thumps and plosives.</li>
          <li><strong style={{ color: 'var(--ink)' }}>Warmth (220 Hz):</strong> Parametric peaking biquad (&plusmn;6 dB) for chest body and vocal fullness.</li>
          <li><strong style={{ color: 'var(--ink)' }}>De-Mud (600 Hz):</strong> Parametric peaking biquad (&plusmn;6 dB) to cut boxy room resonances.</li>
          <li><strong style={{ color: 'var(--ink)' }}>Presence (3 kHz):</strong> Parametric peaking biquad (&plusmn;6 dB) for vocal articulation and speech clarity.</li>
          <li><strong style={{ color: 'var(--ink)' }}>Air (10 kHz):</strong> High-shelf biquad (&plusmn;6 dB) for silky broadcast sheen.</li>
        </ul>
      </section>

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>5. Privacy Guarantee</h2>
        <p style={{ color: 'var(--ink-secondary)', lineHeight: '1.6' }}>
          ClearVoice Studio operates <strong>100% on your device</strong>. No audio file, waveform snippet, transcript, or personal telemetry is ever transmitted over the network. Once the model files are cached in your browser, ClearVoice Studio functions fully in <strong>Airplane Mode</strong> without an internet connection.
        </p>
        <p style={{ margin: 0 }}>
          <a href="/privacy.html" style={{ color: 'var(--accent)' }}>Read our complete Privacy Notice &rarr;</a>
        </p>
      </section>

      <div style={{ textAlign: 'center', marginTop: '2rem' }}>
        <a
          href="#"
          onClick={(e) => {
            if (onBack) {
              e.preventDefault();
              onBack();
            }
          }}
          className="btn-primary"
          style={{ textDecoration: 'none', display: 'inline-block', padding: '0.6rem 1.8rem', borderRadius: 'var(--radius-sm)' }}
        >
          Return to Studio
        </a>
      </div>
    </main>
  );
}
