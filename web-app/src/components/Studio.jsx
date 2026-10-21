import React, { useRef, useState } from 'react';
import { useStudio, versionTitle, engineLabel } from '../studio/useStudio.js';
import { ENGINE_CATALOG, availabilityLabel, isRunnable } from '../studio/engines.ts';
import { checkSecondPass } from '../studio/rules.ts';
import { fileModeSupport } from '../audio/capabilities.js';
import { fmtDuration, durationLimitMinutes } from '../studio/audioTools.js';
import CompareView from './CompareView.jsx';
import VoicePolishPanel from './VoicePolishPanel.jsx';
import { PRESETS, applyPreset, DEFAULTS } from '../audio/presets.js';

const runnable = ENGINE_CATALOG.filter(isRunnable);
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

export default function Studio() {
  const st = useStudio();
  const support = useRef(fileModeSupport()).current;
  const [aId, setA] = useState(null);
  const [bId, setB] = useState(null);
  const [second, setSecond] = useState(null); // {parentId, engineId}
  const [polishId, setPolishId] = useState(null);
  const [exportFormat, setExportFormat] = useState('wav16');
  const [drag, setDrag] = useState(false);
  const [enhanceOpts, setEnhanceOpts] = useState(() => ({ ...DEFAULTS }));
  const { store, versions, originalInfo: orig, busy } = st;

  if (!support.supported) {
    return (
      <div className="studio">
        <div role="alert" className="alert">
          <strong>Browser Not Supported:</strong> {support.reasons.join(' ')} Please use a modern Chrome, Edge, Firefox, or Safari browser.
        </div>
      </div>
    );
  }

  const onFile = async (file) => {
    setA(null);
    setB(null);
    setSecond(null);
    setPolishId(null);
    await st.loadFile(file);
  };

  const origVersion = versions.find((v) => v.kind === 'original');
  const lastOk = [...versions].reverse().find((v) => v.kind === 'result' && v.status === 'ok');
  const autoA = aId ?? origVersion?.id ?? null;
  const autoB = bId ?? lastOk?.id ?? null;

  const check = second ? checkSecondPass(store, second.parentId, second.engineId, { userRequested: true }) : null;

  return (
    <div className="studio">
      <header className="studio-header">
        <div className="studio-brand">
          <div className="studio-logo" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5v14M7 8v8M22 10v4M2 10v4" />
            </svg>
          </div>
          <div>
            <h1>ClearVoice Studio</h1>
            <p className="studio-subtitle">Professional on-device AI speech enhancement &amp; audio mastering</p>
          </div>
        </div>
        <div className="studio-header-actions">
          <a href="#help" className="btn-secondary" style={{ textDecoration: 'none', fontSize: '0.85rem' }}>
            User Guide
          </a>
          <div className="privacy-badge">
            <span className="privacy-pulse" aria-hidden="true" />
            <span>100% Private &amp; On-Device</span>
          </div>
        </div>
      </header>

      {/* Input Recording Section */}
      {!orig && (
        <section className="panel" aria-labelledby="src-h">
          <div className="panel-header">
            <h2 id="src-h">Input Recording</h2>
            <span className="badge tag">Up to {durationLimitMinutes(navigator.deviceMemory || 4)} min</span>
          </div>
          <label
            className={`drop${drag ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
          >
            <div className="drop-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <span className="drop-title">
              {st.loading ? 'Reading and decoding audio...' : 'Drop audio or video here, or click to browse'}
            </span>
            <span className="drop-subtitle">
              Studio-grade speech enhancement running entirely in your browser with zero server uploads.
            </span>
            <div className="drop-formats">
              <span className="drop-tag">WAV</span>
              <span className="drop-tag">MP3</span>
              <span className="drop-tag">M4A</span>
              <span className="drop-tag">OGG</span>
              <span className="drop-tag">WebM</span>
              <span className="drop-tag">MP4 Video</span>
            </div>
            <input
              type="file"
              accept="audio/*,video/mp4,video/webm"
              disabled={st.loading}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>

          {/* Feature Showcase Grid for Empty State */}
          <div className="features-preview">
            <div className="feature-card">
              <div className="feature-card-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Zero Server Uploads</span>
              </div>
              <p>100% on-device inference using WebAssembly SIMD and ONNX Web. Audio never leaves your RAM.</p>
            </div>

            <div className="feature-card">
              <div className="feature-card-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span>Pro Neural Engines</span>
              </div>
              <p>Compare GTCRN (16 kHz, 0.5 MB) and DeepFilterNet3 (48 kHz full-band) side by side.</p>
            </div>

            <div className="feature-card">
              <div className="feature-card-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>Seamless A/B Audition</span>
              </div>
              <p>10 ms smooth crossfade player with matched loudness (-20 LUFS) so louder never tricks your ears.</p>
            </div>

            <div className="feature-card">
              <div className="feature-card-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20v-6M6 20V10M18 20V4" />
                </svg>
                <span>Mastering Polish</span>
              </div>
              <p>Speech-gated auto-leveler and 5-band voice EQ for broadcast-ready warmth and clarity.</p>
            </div>
          </div>
        </section>
      )}

      {orig && (
        <>
          {/* Active Audio Meta Bar */}
          <div className="audio-meta-card">
            <div className="audio-meta-info">
              <div className="audio-meta-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                </svg>
              </div>
              <div>
                <div className="audio-meta-title">{st.name}</div>
                <div className="audio-meta-tags">
                  <span className="meta-pill">{fmtDuration(orig.length / orig.sampleRate)}</span>
                  <span className="meta-pill">{orig.sampleRate / 1000} kHz</span>
                  <span className="meta-pill">{orig.audio.channels.length === 1 ? 'Mono' : 'Stereo'}</span>
                </div>
              </div>
            </div>
            <button
              className="link danger"
              disabled={!!busy}
              onClick={() => {
                if (versions.length > 1) {
                  if (!window.confirm('Start over with a new recording? Current enhancements will be cleared.')) {
                    return;
                  }
                }
                setA(null);
                setB(null);
                setSecond(null);
                setPolishId(null);
                st.reset();
              }}
            >
              Start Over
            </button>
          </div>

          {st.notice && (
            <div
              role={st.noticeType === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              className={st.noticeType === 'error' ? 'alert' : 'status-notice'}
            >
              {st.notice}
            </div>
          )}

          {/* Central Audio Playback & Comparison Workspace */}
          <CompareView store={store} versions={versions} aId={autoA} bId={autoB} setA={setA} setB={setB} />

          {/* Two-Column Workstation Grid */}
          <div className="workstation-grid">
            {/* Left Column: Enhancement Models & DSP Deck */}
            <div className="workstation-col">
              <section className="panel" aria-labelledby="eng-h">
                <div className="panel-header">
                  <h2 id="eng-h">Speech Enhancement Models</h2>
                  <span className="badge tag">WebAssembly &amp; ONNX Web</span>
                </div>

                {/* Quick Presets */}
                <div className="presets-bar">
                  <span style={{ fontSize: '0.84rem', color: 'var(--muted)', fontWeight: 600 }}>Presets:</span>
                  {Object.entries(PRESETS).map(([id, p]) => (
                    <button
                      key={id}
                      type="button"
                      className="preset-chip"
                      onClick={() => setEnhanceOpts((cur) => applyPreset(cur, id))}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Advanced DSP Settings Disclosure */}
                <details className="advanced-settings-box">
                  <summary>
                    ⚙️ Advanced DSP Controls (Strength, Mono, HPF, Echo)
                  </summary>
                  <div className="advanced-settings-grid">
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                        Dry/Wet Strength: {enhanceOpts.strength}%
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={enhanceOpts.strength}
                        onChange={(e) => setEnhanceOpts({ ...enhanceOpts, strength: +e.target.value })}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--muted)' }}>
                        <span>0% (Raw input)</span>
                        <span>100% (Full AI)</span>
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                        Suppression Depth:
                      </label>
                      <select
                        value={enhanceOpts.depth}
                        onChange={(e) => setEnhanceOpts({ ...enhanceOpts, depth: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)' }}
                      >
                        <option value="standard">Standard (balanced)</option>
                        <option value="strong">Strong</option>
                        <option value="maximum">Maximum (deep cut)</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                        Room Echo Reduction:
                      </label>
                      <select
                        value={enhanceOpts.echo}
                        onChange={(e) => setEnhanceOpts({ ...enhanceOpts, echo: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)' }}
                      >
                        <option value="off">Off</option>
                        <option value="low">Low (small room)</option>
                        <option value="medium">Medium</option>
                        <option value="high">High (large room)</option>
                      </select>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={enhanceOpts.mono}
                          onChange={(e) => setEnhanceOpts({ ...enhanceOpts, mono: e.target.checked })}
                          style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                        />
                        <span>Centre the voice (Mono output)</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={enhanceOpts.hpf}
                          onChange={(e) => setEnhanceOpts({ ...enhanceOpts, hpf: e.target.checked })}
                          style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                        />
                        <span>Remove low rumble (HPF 80 Hz)</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={enhanceOpts.clarity}
                          onChange={(e) => setEnhanceOpts({ ...enhanceOpts, clarity: e.target.checked })}
                          style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                        />
                        <span>Clarity boost (Presence &amp; air)</span>
                      </label>
                    </div>
                  </div>
                </details>

                {/* Engine Cards List */}
                <ul className="engines">
                  {ENGINE_CATALOG.map((e) => (
                    <li key={e.id} className={`engine-card${e.id === 'gtcrn' ? ' featured' : ''}`}>
                      <div style={{ flex: 1, minWidth: '200px' }}>
                        <div className="engine-title-row">
                          <span className="engine-name">{e.label}</span>
                          {e.id === 'gtcrn' && <span className="badge recommended">Recommended</span>}
                          <span className={`badge ${e.availability}`}>{availabilityLabel(e.availability)}</span>
                          <span className="badge tag">{e.sampleRate / 1000} kHz</span>
                          {e.approxSizeMB && <span className="badge tag">{e.approxSizeMB} MB</span>}
                        </div>
                        <p className="engine-desc">
                          {e.notes ? `${e.notes} ` : ''}License: {e.license}.
                        </p>
                      </div>
                      {isRunnable(e) && (
                        <button
                          className="btn-primary"
                          disabled={!orig || !!busy}
                          onClick={() => st.run(origVersion.id, e.id, enhanceOpts)}
                        >
                          Enhance Original
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                {busy && (
                  <div role="status" aria-live="polite" className="busy">
                    <progress max="1" value={busy.progress} />
                    <span>
                      {busy.status || `Processing with ${engineLabel(busy.engineId)}: ${Math.round(busy.progress * 100)}%`}
                    </span>
                    <button className="link" onClick={st.cancel}>Cancel</button>
                  </div>
                )}
              </section>
            </div>

            {/* Right Column: Versions, Mastering & History Deck */}
            <div className="workstation-col">
              {versions.length > 0 && (
                <section className="panel" aria-labelledby="ver-h">
                  <div className="panel-header">
                    <h2 id="ver-h">Version History ({versions.length})</h2>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', color: 'var(--muted)' }}>
                      Export Format:
                      <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} style={{ minHeight: '32px', padding: '2px 8px' }}>
                        <option value="wav16">16-bit WAV (Lossless)</option>
                        <option value="wav24">24-bit WAV (Studio)</option>
                        <option value="mp3-192">MP3 (192 kbps)</option>
                        <option value="mp3-256">MP3 (256 kbps High)</option>
                        <option value="mp3-128">MP3 (128 kbps Compact)</option>
                      </select>
                    </label>
                  </div>

                  <ul className="versions">
                    {versions.map((v) => (
                      <li
                        key={v.id}
                        className={`version-card${autoA === v.id ? ' is-active-a' : ''}${autoB === v.id ? ' is-active-b' : ''}`}
                      >
                        <div className="version-info">
                          <div className="version-title">{versionTitle(store, v)}</div>
                          {v.status === 'failed' ? (
                            <div className="alert" style={{ margin: '4px 0', padding: '4px 8px' }}>
                              Failed: {v.error} (Other versions are safe).
                            </div>
                          ) : (
                            <div className="version-meta">
                              <span className="meta-pill">{v.sampleRate / 1000} kHz</span>
                              {v.kind === 'result' && v.processingMs ? <span>Rendered in {secs(v.processingMs)}</span> : null}
                            </div>
                          )}
                        </div>

                        {v.status === 'ok' && (
                          <div className="actions">
                            <button
                              className={`btn-a ${autoA === v.id ? 'active' : ''}`}
                              onClick={() => setA(v.id)}
                              aria-pressed={autoA === v.id}
                              title="Set as Version A for A/B comparison"
                            >
                              A
                            </button>
                            <button
                              className={`btn-b ${autoB === v.id ? 'active' : ''}`}
                              onClick={() => setB(v.id)}
                              aria-pressed={autoB === v.id}
                              title="Set as Version B for A/B comparison"
                            >
                              B
                            </button>
                            <button
                              className="btn-primary"
                              onClick={() => st.download(v.id, exportFormat)}
                              title={`Download as ${exportFormat.startsWith('mp3') ? 'MP3' : 'WAV'}`}
                            >
                              Download {exportFormat.startsWith('mp3') ? 'MP3' : 'WAV'}
                            </button>
                            {exportFormat.startsWith('mp3') ? (
                              <button className="link" onClick={() => st.download(v.id, 'wav16')} title="Quick download as 16-bit WAV">
                                WAV
                              </button>
                            ) : (
                              <button className="link" onClick={() => st.download(v.id, 'mp3-192')} title="Quick download as MP3 (192 kbps)">
                                MP3
                              </button>
                            )}
                            <button
                              className="btn-polish"
                              disabled={!!busy}
                              onClick={() => { setSecond(null); setPolishId(polishId === v.id ? null : v.id); }}
                              aria-pressed={polishId === v.id}
                              title="Open Voice Polish (Dynamic auto-leveler & 5-band voice EQ)"
                            >
                              Polish
                            </button>
                            {v.kind === 'result' && (
                              <button
                                className="link"
                                disabled={!!busy}
                                onClick={() => {
                                  setPolishId(null);
                                  const diffEngine = runnable.find((e) => e.id !== v.engineId) || runnable[0];
                                  setSecond({ parentId: v.id, engineId: diffEngine.id });
                                }}
                                title="Run a second pass through another engine"
                              >
                                Enhance Again
                              </button>
                            )}
                            {v.kind === 'result' && (
                              <button
                                className="link danger"
                                disabled={!!busy}
                                onClick={() => {
                                  st.discard(v.id);
                                  if (aId === v.id) setA(null);
                                  if (bId === v.id) setB(null);
                                  if (polishId === v.id) setPolishId(null);
                                }}
                                title="Discard this version"
                              >
                                Discard
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>

                  {/* Voice Polish Panel */}
                  {polishId && store.get(polishId) && (
                    <VoicePolishPanel
                      store={store}
                      versionId={polishId}
                      onClose={() => setPolishId(null)}
                      onApply={async (id, opts, label) => {
                        const newId = await st.applyPolish(id, opts, label);
                        if (newId) {
                          setA(id);
                          setB(newId);
                        }
                      }}
                    />
                  )}

                  {/* Second Pass Confirmation */}
                  {second && check && (
                    <div className="second" role="group" aria-label="Second pass configuration">
                      <p><strong>Enhance {versionTitle(store, store.get(second.parentId))} again</strong></p>
                      <label className="field">
                        Target Model:
                        <select value={second.engineId} onChange={(e) => setSecond({ ...second, engineId: e.target.value })}>
                          {runnable.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                        </select>
                      </label>
                      {check.warnings.map((w) => <p key={w} className="warn">{w}</p>)}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                        <button
                          className="btn-primary"
                          disabled={!check.allowed || !!busy}
                          onClick={async () => {
                            const s = second;
                            setSecond(null);
                            setA(s.parentId);
                            await st.run(s.parentId, s.engineId, enhanceOpts);
                          }}
                        >
                          Run Second Pass
                        </button>
                        <button className="link" onClick={() => setSecond(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* External Audio Importer */}
              <details className="panel" style={{ cursor: 'pointer' }}>
                <summary style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--ink)' }}>
                  📁 Import External Tool Result for A/B Comparison
                </summary>
                <p className="hint" style={{ marginTop: '10px' }}>
                  Import an audio file processed by any external software to audition it side by side with ClearVoice Studio. Sample rate, duration, and loudness (-20 LUFS) will align automatically.
                </p>
                <label className="field" style={{ marginTop: '12px' }}>
                  Choose Processed Audio File:
                  <input
                    type="file"
                    accept="audio/*"
                    disabled={!!busy}
                    onChange={(e) => { st.importResult(e.target.files?.[0]); e.target.value = ''; }}
                  />
                </label>
              </details>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
