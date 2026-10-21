import { useCallback, useMemo, useRef, useState } from 'react';
import { VersionStore } from './versions.ts';
import { JobCoordinator } from './coordinator.ts';
import { ENGINE_CATALOG } from './engines.ts';
import { buildEngines } from './runtime.js';
import { decodeAudioFile, UserError } from '../audio/file-client.js';
import { resampleChunked } from '../audio/resample-async.js';
import { encodeWavParts } from '../audio/encode-wav.js';
import { encodeMp3 } from '../audio/encode-mp3.js';
import { loadMp3 } from '../workers/load-mp3.js';
import { durationLimitMinutes, storeBudgetBytes, fitLength, matchChannels, safeName } from './audioTools.js';
import { applyVoicePolish, applyVoicePolishAsync } from '../audio/voice-polish.js';

const mem = () => (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;

export function engineLabel(id) {
  if (id === 'voice-polish') return 'Voice Polish';
  return ENGINE_CATALOG.find((e) => e.id === id)?.label ?? id;
}

export function versionTitle(store, v) {
  if (v.kind === 'original') return 'Original';
  const stage = store.lineage(v.id).length - 1;
  return `Stage ${stage}: ${v.label || engineLabel(v.engineId)}`;
}

export function friendlyErrorMessage(err) {
  if (!err) return 'Something went wrong.';
  if (err.name === 'AbortError' || err.message === 'cancelled') {
    return 'Cancelled. Your earlier results are untouched.';
  }
  const msg = err.message || String(err);
  const code = err.code || '';

  if (code === 'MEMORY_BUDGET' || msg.includes('Memory budget') || msg.includes('canFit')) {
    return 'Not enough free memory to process this audio. Try a shorter clip or close other tabs.';
  }
  if (code === 'WORKER_CRASHED' || msg.includes('out of memory') || msg.includes('OOM') || msg.includes('memory access out of bounds')) {
    return 'The processing engine ran out of memory. Try a shorter clip or use a desktop browser.';
  }
  if (code === 'DECODE_FAILED' || msg.includes('decodeAudioData') || msg.includes('Could not read this file')) {
    return 'Could not decode audio. Please check the file format (WAV, MP3, M4A, OGG, WebM, MP4 supported).';
  }
  if (msg.includes('fetch failed') || msg.includes('Failed to fetch') || msg.includes('network') || msg.includes('NetworkError')) {
    return 'Could not download the model files. Check your internet connection and try again.';
  }
  if (code === 'TOO_LONG' || code === 'TOO_LARGE') {
    return msg;
  }
  return msg || 'An unexpected error occurred. Please try again.';
}

export function useStudio() {
  const rt = useRef(null);
  if (!rt.current) {
    const engines = buildEngines();
    const store = new VersionStore(storeBudgetBytes(mem()));
    // one worker per engine and one job at a time: workers keep a single result cache
    rt.current = { engines, store, co: new JobCoordinator(store, engines, 1), handle: null, name: 'audio' };
  }
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const [busy, setBusy] = useState(null); // {engineId, parentId, progress}
  const [notice, setNotice] = useState(null); // { text: string, type: 'status' | 'error' }
  const [loading, setLoading] = useState(false);

  const store = rt.current.store;
  const versions = store.list();

  const say = (e) => {
    if (!e) { setNotice(null); return; }
    if (e.name === 'AbortError' || e.message === 'cancelled') {
      setNotice({ text: 'Cancelled. Your earlier results are untouched.', type: 'status' });
    } else {
      setNotice({ text: friendlyErrorMessage(e), type: 'error' });
    }
  };
  const setStatus = (text) => setNotice(text ? { text, type: 'status' } : null);

  const loadFile = useCallback(async (file) => {
    if (!file) return;
    setNotice(null); setLoading(true);
    try {
      const decoded = await decodeAudioFile(file);
      const limit = durationLimitMinutes(mem());
      if (decoded.duration > limit * 60) throw new UserError(`This recording is ${Math.round(decoded.duration / 60)} minutes long. On this device the limit is ${limit} minutes: trim it first, or use a computer.`, 'TOO_LONG');
      const fresh = new VersionStore(storeBudgetBytes(mem()));
      fresh.setOriginal({ channels: decoded.channels, sampleRate: decoded.sampleRate });
      rt.current.store = fresh;
      rt.current.co = new JobCoordinator(fresh, rt.current.engines, 1);
      rt.current.name = safeName(file.name);
    } catch (e) { say(e); } finally { setLoading(false); refresh(); }
  }, [refresh]);

  const reset = useCallback(() => {
    const fresh = new VersionStore(storeBudgetBytes(mem()));
    rt.current.store = fresh;
    rt.current.co = new JobCoordinator(fresh, rt.current.engines, 1);
    rt.current.name = 'audio';
    setNotice(null);
    setBusy(null);
    refresh();
  }, [refresh]);

  const run = useCallback(async (parentId, engineId) => {
    if (busy) return;
    setNotice(null); setBusy({ engineId, parentId, progress: 0, status: 'Initializing engine...' });
    const handle = rt.current.co.enqueue(parentId, engineId, {
      onProgress: (p) => setBusy((b) => (b ? { ...b, progress: p, status: null } : b)),
      onStatus: (status) => setBusy((b) => (b ? { ...b, status } : b)),
    });
    rt.current.handle = handle;
    try { await handle.promise; } catch (e) { say(e); } finally { rt.current.handle = null; setBusy(null); refresh(); }
  }, [busy, refresh]);

  const cancel = useCallback(() => rt.current.handle?.cancel(), []);

  /** Add a result made elsewhere (for example Resemble Enhance run on your computer). */
  const importResult = useCallback(async (file) => {
    const s = rt.current.store;
    const origId = s.originalId();
    if (!file || !origId) return;
    setNotice(null);
    try {
      const o = s.get(origId);
      const d = await decodeAudioFile(file);
      let chs = d.channels;
      if (d.sampleRate !== o.sampleRate) chs = await Promise.all(chs.map((c) => resampleChunked(c, d.sampleRate, o.sampleRate)));
      chs = fitLength(matchChannels(chs, o.audio.channels.length), o.length);
      s.addResult(origId, 'external', { channels: chs, sampleRate: o.sampleRate }, 0, `Imported: ${file.name}`);
    } catch (e) { say(e); } finally { refresh(); }
  }, [refresh]);

  const applyPolish = useCallback(async (parentId, options, label) => {
    if (busy) return null;
    const s = rt.current.store;
    const parent = s.get(parentId);
    if (!parent?.audio) return null;
    setNotice(null);
    setBusy({ engineId: 'voice-polish', parentId, progress: 0 });
    const abortCtrl = new AbortController();
    rt.current.handle = { cancel: () => abortCtrl.abort() };
    const t0 = Date.now();
    try {
      const outChannels = await applyVoicePolishAsync(
        parent.audio.channels,
        parent.audio.sampleRate,
        options,
        {
          signal: abortCtrl.signal,
          onProgress: (p) => setBusy((b) => (b ? { ...b, progress: p } : b)),
        }
      );
      const v = s.addResult(
        parentId,
        'voice-polish',
        { channels: outChannels, sampleRate: parent.audio.sampleRate },
        Date.now() - t0,
        label || 'Voice Polish'
      );
      refresh();
      return v.id;
    } catch (e) {
      say(e);
      return null;
    } finally {
      rt.current.handle = null;
      setBusy(null);
      refresh();
    }
  }, [busy, refresh]);

  const discard = useCallback((id) => { try { rt.current.store.discard(id); } catch (e) { say(e); } refresh(); }, [refresh]);

  const download = useCallback(async (id, format = 'wav16') => {
    const v = rt.current.store.get(id);
    if (!v?.audio) return;
    const tag = v.kind === 'original' ? 'original' : (v.label ? 'imported' : v.engineId);

    if (typeof format === 'string' && format.startsWith('mp3')) {
      const kbps = parseInt(format.replace('mp3-', ''), 10) || 192;
      setStatus('Encoding MP3...');
      try {
        const Mp3Encoder = await loadMp3();
        const parts = await encodeMp3(v.audio.channels, v.audio.sampleRate, kbps, {
          Mp3Encoder,
          onProgress: (p) => setStatus(`Encoding MP3: ${Math.round(p * 100)}%`),
        });
        const blob = new Blob(parts, { type: 'audio/mpeg' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${rt.current.name}-${tag}-${v.id}.mp3`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        setNotice(null);
      } catch (err) {
        say(err);
      }
    } else {
      const bits = format === 'wav24' || format === 24 ? 24 : 16;
      const parts = encodeWavParts(v.audio.channels, v.audio.sampleRate, bits);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(parts, { type: 'audio/wav' }));
      a.download = `${rt.current.name}-${tag}-${v.id}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  }, []);

  const originalId = store.originalId();
  const info = useMemo(() => (originalId ? store.get(originalId) : null), [originalId, store]);
  return {
    store,
    versions,
    originalInfo: info,
    busy,
    notice: notice?.text || '',
    noticeType: notice?.type || 'status',
    loading,
    loadFile,
    run,
    cancel,
    reset,
    importResult,
    applyPolish,
    discard,
    download,
    name: rt.current.name,
    clearNotice: () => setNotice(null),
  };
}
