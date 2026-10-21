import React, { useEffect, useMemo, useRef, useState } from 'react';
import { decodeAudioFile, createFileJob, UserError } from '../audio/file-client.js';
import { DEPTH_LEVELS, ECHO_LEVELS } from '../audio/postprocess.js';
import { PRESETS, applyPreset, loadSettings, saveSettings } from '../audio/presets.js';
import { fileModeSupport } from '../audio/capabilities.js';
import ABPlayer from './ABPlayer.jsx';

const PREVIEW_SECONDS = 20;
const ENGINES = [
  { id: 'gtcrn', label: 'GTCRN (trained model, default)' },
  { id: 'spectral-gate-demo', label: 'Demo noise gate (rough, not a trained model)' },
  { id: 'passthrough', label: 'Passthrough (testing only)' },
];
const FORMATS = [
  { id: 'wav16', label: 'WAV 16-bit', opts: { format: 'wav16' } },
  { id: 'wav24', label: 'WAV 24-bit', opts: { format: 'wav24' } },
  { id: 'mp3-128', label: 'MP3 128 kbps', opts: { format: 'mp3', kbps: 128 } },
  { id: 'mp3-192', label: 'MP3 192 kbps', opts: { format: 'mp3', kbps: 192 } },
  { id: 'mp3-256', label: 'MP3 256 kbps', opts: { format: 'mp3', kbps: 256 } },
];
const PROCESS_KEYS = ['hpf', 'depth', 'echo', 'clarity', 'mono', 'engine'];

function recoveryFor(code) {
  if (code === 'MODEL_LOAD_FAILED') return { retry: true, reload: true };
  if (code === 'UNKNOWN_MODEL') return { another: true };
  if (code === 'DECODE_FAILED' || code === 'TOO_LARGE' || code === 'UNSUPPORTED') return { another: true };
  return { retry: true, another: true };
}

export default function EnhancerUI() {
  const job = useMemo(() => createFileJob(), []);
  const support = useMemo(() => fileModeSupport(), []);
  const [s, setS] = useState(() => loadSettings());
  const set = (patch) => setS((old) => ({ ...old, ...patch }));
  const [phase, setPhase] = useState('idle'); // idle | decoding | processing | ready | error
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState(null); // {message, code}
  const [modelLabel, setModelLabel] = useState('');
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [ab, setAb] = useState(null);
  const [stats, setStats] = useState(null);
  const [fmt, setFmt] = useState('wav16');
  const [exporting, setExporting] = useState(false);
  const [exportInfo, setExportInfo] = useState('');
  const [used, setUsed] = useState(null); // process-time settings of the current result
  const meta = useRef({ name: 'audio' });
  const fileRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => saveSettings(s), [s]);
  useEffect(() => () => job.dispose(), [job]);

  // live preview: a short window, debounced; stale answers are dropped
  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const h = setTimeout(async () => {
      const mine = ++seq.current;
      try {
        const m = await job.previewAB({ strength: s.strength / 100, targetLufs: s.target }, { startSec: start, lengthSec: PREVIEW_SECONDS });
        if (mine !== seq.current) return;
        setStats(m.stats);
        setAb({ a: m.a, b: m.b, sampleRate: used ? used.sampleRate : 48000 });
      } catch (e) {
        if (!e.cancelled && mine === seq.current) setExportInfo(e.message || 'Preview failed.');
      }
    }, 250);
    return () => clearTimeout(h);
  }, [phase, s.strength, s.target, start, job, used]);

  async function run(file) {
    if (!file) return;
    fileRef.current = file;
    setErr(null); setExportInfo(''); setStats(null); setAb(null);
    try {
      setPhase('decoding'); setStatus('Reading file...');
      const { channels, sampleRate } = await decodeAudioFile(file);
      meta.current = { name: file.name.replace(/\.[^.]+$/, '') };
      setPhase('processing'); setProgress(0);
      const options = {
        modelId: s.engine, depth: DEPTH_LEVELS[s.depth], rt60: ECHO_LEVELS[s.echo], clarity: s.clarity, mono: s.mono,
        hpf: { enabled: s.hpf, fc: 80 },
      };
      const done = await job.process({ channels, sampleRate, options }, { onProgress: setProgress, onStatus: setStatus });
      setModelLabel(done.modelLabel); setDuration(done.durationSec); setStart(0);
      setUsed({ ...Object.fromEntries(PROCESS_KEYS.map((k) => [k, s[k]])), sampleRate });
      setPhase('ready');
    } catch (e) {
      if (e.cancelled) { setPhase('idle'); return; }
      setErr({ message: e instanceof UserError ? e.message : 'Something went wrong. Please try again.', code: e.code || 'ERROR' });
      setPhase('error');
    }
  }

  async function download() {
    const f = FORMATS.find((x) => x.id === fmt);
    setExporting(true); setProgress(0); setExportInfo('Starting...');
    try {
      const m = await job.export({ strength: s.strength / 100, targetLufs: s.target, ...f.opts },
        { onStatus: setExportInfo, onProgress: (v) => setExportInfo(`Encoding... ${Math.round(v * 100)}%`) });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(m.parts, { type: m.mime }));
      a.download = `${meta.current.name}-enhanced.${m.ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setExportInfo(`Exported ${f.label} at ${m.stats.lufs.toFixed(1)} LUFS (peak limiter reduced up to ${m.stats.maxGainReductionDb.toFixed(1)} dB).`);
    } catch (e) {
      setExportInfo(e.cancelled ? 'Export cancelled.' : (e.message || 'Export failed.'));
    } finally {
      setExporting(false);
    }
  }

  if (!support.supported) {
    return (
      <section aria-labelledby="enh-h">
        <h2 id="enh-h">Fix a recording</h2>
        <p role="alert">This browser cannot run the enhancer: {support.reasons.join(' ')} Please use a recent Chrome, Edge, Firefox or Safari.</p>
      </section>
    );
  }

  const busy = phase === 'decoding' || phase === 'processing';
  const changed = used && PROCESS_KEYS.some((k) => used[k] !== s[k]);
  const rec = err ? recoveryFor(err.code) : {};
  return (
    <section aria-labelledby="enh-h">
      <h2 id="enh-h">Fix a recording</h2>
      <p>Processed on your device. Nothing is uploaded.</p>
      {!busy && (
        <>
          <p>
            Presets:{' '}
            {Object.entries(PRESETS).map(([id, p]) => <button key={id} onClick={() => set(applyPreset(s, id))}>{p.label}</button>)}
          </p>
          <label>Choose an audio or video file <input type="file" accept="audio/*,video/mp4,video/webm" onChange={(e) => run(e.target.files && e.target.files[0])} /></label>
          <details>
            <summary>Voice polish (applies when a file is processed)</summary>
            <label>Noise suppression
              <select value={s.depth} onChange={(e) => set({ depth: e.target.value })}>
                <option value="standard">Standard</option>
                <option value="strong">Strong</option>
                <option value="maximum">Maximum (may sound processed)</option>
              </select>
            </label>
            <label>Echo reduction (experimental, can sound watery)
              <select value={s.echo} onChange={(e) => set({ echo: e.target.value })}>
                <option value="off">Off</option>
                <option value="low">Low (small room)</option>
                <option value="medium">Medium</option>
                <option value="high">High (large or very echoey room)</option>
              </select>
            </label>
            <label><input type="checkbox" checked={s.hpf} onChange={(e) => set({ hpf: e.target.checked })} /> Remove low rumble (80 Hz)</label>
            <label><input type="checkbox" checked={s.mono} onChange={(e) => set({ mono: e.target.checked })} /> Centre the voice (mono output, removes stereo room sound)</label>
            <label><input type="checkbox" checked={s.clarity} onChange={(e) => set({ clarity: e.target.checked })} /> Clarity boost (less boxy, more presence and air)</label>
          </details>
          <details>
            <summary>Engine</summary>
            <select value={s.engine} onChange={(e) => set({ engine: e.target.value })} aria-label="Enhancement engine">
              {ENGINES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </details>
        </>
      )}
      <div role="status" aria-live="polite">
        {busy && `${status} ${phase === 'processing' ? Math.round(progress * 100) + '%' : ''}`}
      </div>
      {phase === 'processing' && <><progress max="1" value={progress} /> <button onClick={() => job.cancel()}>Cancel</button></>}
      {phase === 'error' && err && (
        <div role="alert">
          <p>{err.message}</p>
          {rec.retry && fileRef.current && <button onClick={() => run(fileRef.current)}>Try again</button>}{' '}
          {rec.reload && <button onClick={() => window.location.reload()}>Reload the page</button>}{' '}
          {rec.another && <small>Choose another file above.</small>}
        </div>
      )}
      {phase === 'ready' && (
        <div>
          <p>Engine: {modelLabel}. Previewing {PREVIEW_SECONDS} s from {Math.round(start)} s; export renders the whole file.</p>
          {ab && <ABPlayer a={ab.a} b={ab.b} sampleRate={ab.sampleRate} />}
          <label>Preview start {Math.round(start)} s
            <input type="range" min="0" max={Math.max(0, Math.floor(duration - PREVIEW_SECONDS))} value={start} onChange={(e) => setStart(+e.target.value)} />
          </label>
          <label>Strength {s.strength}%
            <input type="range" min="0" max="100" value={s.strength} onChange={(e) => set({ strength: +e.target.value })} />
          </label>
          <label>Target loudness (LUFS)
            <input type="number" min="-30" max="-8" step="1" value={s.target} onChange={(e) => set({ target: +e.target.value })} />
          </label>
          {stats && <p>Gain {stats.gainDb.toFixed(1)} dB; peak limiter {stats.maxGainReductionDb.toFixed(1)} dB reduction in this preview</p>}
          {changed && <p>Polish settings changed. <button onClick={() => run(fileRef.current)}>Apply to this file</button></p>}
          <label>Export as{' '}
            <select value={fmt} onChange={(e) => setFmt(e.target.value)}>
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>{' '}
          <button disabled={exporting} onClick={download}>Download</button>{' '}
          {exporting && <button onClick={() => job.cancel()}>Cancel export</button>}
          <p role="status" aria-live="polite">{exportInfo}</p>
        </div>
      )}
    </section>
  );
}
