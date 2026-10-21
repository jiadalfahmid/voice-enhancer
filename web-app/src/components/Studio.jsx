import React, { useRef, useState } from 'react';
import { useStudio, versionTitle, engineLabel } from '../studio/useStudio.js';
import { ENGINE_CATALOG, availabilityLabel, isRunnable } from '../studio/engines.ts';
import { checkSecondPass } from '../studio/rules.ts';
import { fileModeSupport } from '../audio/capabilities.js';
import { fmtDuration, durationLimitMinutes } from '../studio/audioTools.js';
import CompareView from './CompareView.jsx';
import VoicePolishPanel from './VoicePolishPanel.jsx';

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
        <div className="privacy-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>100% Private &amp; On-Device</span>
        </div>
      </header>

      {/* Recording Source Section */}
      <section className="panel" aria-labelledby="src-h">
        <div className="panel-header">
          <h2 id="src-h" style={{ margin: 0 }}>Input Recording</h2>
        </div>
        {!orig && (
          <label
            className={`drop${drag ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
          >
            <div className="drop-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <span className="drop-title">
              {st.loading ? 'Reading and decoding audio...' : 'Drop audio or video here, or click to browse'}
            </span>
            <span className="drop-subtitle">
              Supports WAV, MP3, M4A, OGG, WebM, MP4 &bull; Up to {durationLimitMinutes(navigator.deviceMemory || 4)} min
            </span>
            <input
              type="file"
              accept="audio/*,video/mp4,video/webm"
              disabled={st.loading}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
        )}
        {orig && (
          <div className="audio-meta-card">
            <div className="audio-meta-info">
              <div className="audio-meta-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
              className="link"
              disabled={!!busy}
              onClick={() => { setA(null); setB(null); window.location.reload(); }}
            >
              Start Over
            </button>
          </div>
        )}
        {st.notice && <div role="alert" className="alert" style={{ marginTop: '12px' }}>{st.notice}</div>}
      </section>

      {/* AI Enhancement Engines */}
      <section className="panel" aria-labelledby="eng-h">
        <div className="panel-header">
          <h2 id="eng-h" style={{ margin: 0 }}>Speech Enhancement Models</h2>
        </div>
        <ul className="engines">
          {ENGINE_CATALOG.map((e) => (
            <li key={e.id} className="engine-card">
              <div style={{ flex: 1, minWidth: '220px' }}>
                <div className="engine-title-row">
                  <span className="engine-name">{e.label}</span>
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
                  onClick={() => st.run(origVersion.id, e.id)}
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
            <span>Processing with {engineLabel(busy.engineId)}: {Math.round(busy.progress * 100)}%</span>
            <button onClick={st.cancel}>Cancel</button>
          </div>
        )}
      </section>

      {/* Versions & Workflow */}
      {versions.length > 0 && (
        <section className="panel" aria-labelledby="ver-h">
          <div className="panel-header">
            <h2 id="ver-h" style={{ margin: 0 }}>Version History</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.86rem', color: 'var(--muted)' }}>
              Export Format:
              <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} style={{ minHeight: '30px', padding: '2px 8px' }}>
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
              <li key={v.id} className="version-card">
                <div className="version-info">
                  <div className="version-title">{versionTitle(store, v)}</div>
                  {v.status === 'failed' ? (
                    <div className="alert" style={{ margin: '4px 0', padding: '4px 8px' }}>
                      Failed: {v.error} (Other versions are safe).
                    </div>
                  ) : (
                    <div className="version-meta">
                      <span>{v.sampleRate / 1000} kHz</span>
                      {v.kind === 'result' && v.processingMs ? <span>&bull; Rendered in {secs(v.processingMs)}</span> : null}
                    </div>
                  )}
                </div>

                {v.status === 'ok' && (
                  <div className="actions">
                    <button
                      className="btn-a"
                      onClick={() => setA(v.id)}
                      aria-pressed={autoA === v.id}
                      title="Set as Version A for comparison"
                    >
                      A
                    </button>
                    <button
                      className="btn-b"
                      onClick={() => setB(v.id)}
                      aria-pressed={autoB === v.id}
                      title="Set as Version B for comparison"
                    >
                      B
                    </button>
                    {v.kind === 'result' && (
                      <button
                        disabled={!!busy}
                        onClick={() => { setPolishId(null); setSecond({ parentId: v.id, engineId: runnable[0].id }); }}
                      >
                        Enhance Again
                      </button>
                    )}
                    <button
                      className="btn-polish"
                      disabled={!!busy}
                      onClick={() => { setSecond(null); setPolishId(polishId === v.id ? null : v.id); }}
                      aria-pressed={polishId === v.id}
                    >
                      Polish (EQ &amp; Leveler)
                    </button>
                    <button onClick={() => st.download(v.id, exportFormat)}>
                      Download {exportFormat.startsWith('mp3') ? 'MP3' : 'WAV'}
                    </button>
                    {exportFormat.startsWith('mp3') ? (
                      <button className="link" onClick={() => st.download(v.id, 'wav16')} title="Download as 16-bit WAV">
                        WAV
                      </button>
                    ) : (
                      <button className="link" onClick={() => st.download(v.id, 'mp3-192')} title="Download as MP3 (192 kbps)">
                        MP3
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
              onApply={(id, opts, label) => {
                const newId = st.applyPolish(id, opts, label);
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
                    await st.run(s.parentId, s.engineId);
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

      {/* Comparison Player */}
      {versions.some((v) => v.kind === 'result' && v.status === 'ok') && (
        <CompareView store={store} versions={versions} aId={autoA} bId={autoB} setA={setA} setB={setB} />
      )}

      {/* External Audio Importer */}
      {orig && (
        <section className="panel" aria-labelledby="imp-h">
          <div className="panel-header">
            <h2 id="imp-h" style={{ margin: 0 }}>Add External Audio Result</h2>
          </div>
          <p className="hint">
            Import an audio file processed by an external tool to compare it with browser models. The studio will automatically align sample rate, duration, and loudness.
          </p>
          <label className="field" style={{ marginTop: '10px' }}>
            Choose Processed Audio File:
            <input
              type="file"
              accept="audio/*"
              disabled={!!busy}
              onChange={(e) => { st.importResult(e.target.files?.[0]); e.target.value = ''; }}
            />
          </label>
        </section>
      )}
    </div>
  );
}
