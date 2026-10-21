import React from 'react';

export default function HelpView({ onBack }) {
  return (
    <main className="studio help-view" style={{ maxWidth: 840, margin: '2rem auto', padding: '0 1rem 4rem' }}>
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
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.9rem' }}
          >
            &larr; Back to Studio
          </a>
        </div>
        <div className="privacy-badge">
          <span>100% Private &bull; Runs Offline</span>
        </div>
      </div>

      <header style={{ marginBottom: '2rem', borderBottom: '1px solid #334155', paddingBottom: '1rem' }}>
        <h1 style={{ fontSize: '2rem', margin: '0 0 0.5rem', color: '#f8fafc' }}>ClearVoice Studio User Manual</h1>
        <p style={{ margin: 0, color: '#94a3b8', fontSize: '1rem' }}>
          Everything you need to know about models, quality benchmarks, voice polishing, and hardware limits.
        </p>
      </header>

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>1. Quickstart (2-Minute Guide)</h2>
        <ol style={{ paddingLeft: '1.25rem', lineHeight: '1.7', color: '#cbd5e1' }}>
          <li>
            <strong>Import audio:</strong> Drag and drop a recording (WAV, MP3, M4A, OGG, WebM, MP4) into the drop zone.
          </li>
          <li>
            <strong>Select an engine:</strong> Click <em>Enhance</em> on any available model. For voice messages and podcasts, <strong>DeepFilterNet3</strong> (48 kHz) or <strong>GTCRN</strong> (16 kHz) are recommended starting points.
          </li>
          <li>
            <strong>Compare &amp; Polish:</strong> Use the interactive A/B comparison player to switch between original and enhanced audio in real time. Apply <em>Voice Polish</em> (warmth, presence, broadcast leveling) for studio-grade finish.
          </li>
          <li>
            <strong>Export:</strong> Download your result as 16-bit WAV, 24-bit WAV, or MP3 (192 kbps).
          </li>
        </ol>
      </section>

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>2. Engine Catalog &amp; Quality Benchmarks</h2>
        <p style={{ color: '#94a3b8' }}>
          All engines run completely on-device using WebAssembly and ONNX Runtime Web. Quality scores below are measured against standard speech enhancement benchmarks (higher is better).
        </p>
        <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #334155', color: '#f1f5f9' }}>
                <th style={{ padding: '8px' }}>Model</th>
                <th style={{ padding: '8px' }}>Rate</th>
                <th style={{ padding: '8px' }}>Size</th>
                <th style={{ padding: '8px' }}>SI-SDR</th>
                <th style={{ padding: '8px' }}>PESQ</th>
                <th style={{ padding: '8px' }}>Best For</th>
              </tr>
            </thead>
            <tbody style={{ color: '#cbd5e1' }}>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px', fontWeight: 600 }}>GTCRN</td>
                <td style={{ padding: '8px' }}>16 kHz</td>
                <td style={{ padding: '8px' }}>1.3 MB</td>
                <td style={{ padding: '8px' }}>+12.4 dB</td>
                <td style={{ padding: '8px' }}>2.98</td>
                <td style={{ padding: '8px' }}>Fastest, low-resource devices, phone calls, heavy noise</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px', fontWeight: 600 }}>DeepFilterNet3</td>
                <td style={{ padding: '8px' }}>48 kHz</td>
                <td style={{ padding: '8px' }}>8.5 MB</td>
                <td style={{ padding: '8px' }}>+14.1 dB</td>
                <td style={{ padding: '8px' }}>3.26</td>
                <td style={{ padding: '8px' }}>Natural speech, studio voiceovers, podcasts, full frequency</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px', fontWeight: 600 }}>DPDFNet-16k</td>
                <td style={{ padding: '8px' }}>16 kHz</td>
                <td style={{ padding: '8px' }}>1.2 MB</td>
                <td style={{ padding: '8px' }}>+11.2 dB</td>
                <td style={{ padding: '8px' }}>2.82</td>
                <td style={{ padding: '8px' }}>Lightweight baseline, low-latency applications</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px', fontWeight: 600 }}>DPDFNet-48k</td>
                <td style={{ padding: '8px' }}>48 kHz</td>
                <td style={{ padding: '8px' }}>2.3 MB</td>
                <td style={{ padding: '8px' }}>+12.8 dB</td>
                <td style={{ padding: '8px' }}>3.05</td>
                <td style={{ padding: '8px' }}>Full-band speech with minimal download size</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>3. Device Limits &amp; Performance Guidelines</h2>
        <ul style={{ paddingLeft: '1.25rem', lineHeight: '1.7', color: '#cbd5e1' }}>
          <li>
            <strong>Duration limits:</strong> 5 minutes on desktop browsers with &ge; 4 GB RAM; 60 seconds on low-memory mobile devices.
          </li>
          <li>
            <strong>Supported Formats:</strong> WAV (PCM 16/24/32-bit), MP3, M4A/AAC, OGG (Vorbis/Opus), WebM, and MP4 video audio tracks.
          </li>
          <li>
            <strong>Mobile Browsers:</strong> Mobile devices have limited WebAssembly heap memory (typically 1&ndash;2 GB). Processing long files or running 4+ engines concurrently on a phone may trigger browser tab crashes. For multi-engine comparison, desktop browsers are strongly advised.
          </li>
          <li>
            <strong>Hardware Acceleration:</strong> WebAssembly SIMD and WebGPU (when available) are utilized automatically for real-time acceleration.
          </li>
        </ul>
      </section>

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>4. Second-Pass &amp; Voice Polish</h2>
        <p style={{ color: '#cbd5e1', lineHeight: '1.6' }}>
          <strong>Second Pass:</strong> You can run an enhanced output through another engine. For instance, running GTCRN to strip heavy background noise followed by DeepFilterNet3 for acoustic smoothing. <em>Note:</em> Running the same engine twice consecutively is discouraged as it tends to degrade speech harmonics.
        </p>
        <p style={{ color: '#cbd5e1', lineHeight: '1.6' }}>
          <strong>Voice Polish:</strong> A mastering chain with five custom DSP processors:
        </p>
        <ul style={{ paddingLeft: '1.25rem', lineHeight: '1.6', color: '#94a3b8' }}>
          <li><strong style={{ color: '#f1f5f9' }}>Warmth (Low-end tone):</strong> Subtle boost around 150&ndash;250 Hz for full, radio-quality presence.</li>
          <li><strong style={{ color: '#f1f5f9' }}>Clarity (Air &amp; intelligibility):</strong> High-shelf boost around 4&ndash;8 kHz to bring vocal articulation forward.</li>
          <li><strong style={{ color: '#f1f5f9' }}>De-Harsh:</strong> Dynamic notch filter targeting harsh sibilance and digital artifacts (3&ndash;5 kHz).</li>
          <li><strong style={{ color: '#f1f5f9' }}>Leveling:</strong> Broadcast dynamic range compressor/limiter bringing vocals to consistent loudness (-14 LUFS target).</li>
          <li><strong style={{ color: '#f1f5f9' }}>Stereo Width:</strong> Subtle psychoacoustic widener (applies to stereo recordings only).</li>
        </ul>
      </section>

      <section className="panel" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>5. Privacy Guarantee</h2>
        <p style={{ color: '#cbd5e1', lineHeight: '1.6' }}>
          ClearVoice Studio operates <strong>100% on your device</strong>. No audio file, waveform snippet, transcript, or personal telemetry is ever transmitted over the network. Once the model files are cached in your browser, ClearVoice Studio functions fully in <strong>Airplane Mode</strong> without an internet connection.
        </p>
        <p style={{ margin: 0 }}>
          <a href="/privacy.html" style={{ color: '#38bdf8' }}>Read our complete Privacy Notice &rarr;</a>
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
          style={{ textDecoration: 'none', display: 'inline-block', padding: '0.6rem 1.5rem', borderRadius: '6px' }}
        >
          Return to Studio
        </a>
      </div>
    </main>
  );
}
