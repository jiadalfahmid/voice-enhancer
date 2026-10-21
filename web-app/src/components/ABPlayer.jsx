import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computePeaks, gainsFor, loopPosition, CROSSFADE_SECONDS } from '../audio/ab.js';
import { fmtDuration } from '../studio/audioTools.js';

// A/B player: both versions play in lockstep through two gain nodes; toggling crossfades over 10 ms.
// When singleTrack is true, functions as a high-fidelity single track waveform player.
export default function ABPlayer({ a, b, sampleRate, labelA = 'Original', labelB = 'Enhanced', singleTrack = false }) {
  const canvasRef = useRef(null);
  const st = useRef({ ctx: null, gA: null, gB: null, bufA: null, bufB: null, srcA: null, srcB: null, startedAt: 0, offset: 0, playing: false, raf: 0 });
  const [playing, setPlaying] = useState(false);
  const [which, setWhich] = useState(singleTrack ? 'a' : 'b');
  const [pos, setPos] = useState(0);
  const dur = a[0].length / sampleRate;
  const peaksA = useMemo(() => computePeaks(a, 900), [a]);
  const peaksB = useMemo(() => (b ? computePeaks(b, 900) : peaksA), [b, peaksA]);

  const makeBuffer = (ctx, chs) => {
    const buf = ctx.createBuffer(chs.length, chs[0].length, sampleRate);
    chs.forEach((c, i) => buf.copyToChannel(c, i));
    return buf;
  };
  const position = () => {
    const s = st.current;
    return s.playing ? loopPosition(s.ctx.currentTime - s.startedAt, dur) : s.offset;
  };
  const stopSources = () => {
    const s = st.current;
    for (const k of ['srcA', 'srcB']) { try { s[k] && s[k].stop(); } catch { /* already stopped */ } s[k] = null; }
  };
  const startAt = (offset) => {
    const s = st.current;
    stopSources();
    const isSingle = singleTrack || !b;
    if (isSingle) {
      const src = s.ctx.createBufferSource();
      src.buffer = s.bufA; src.loop = true; src.loopEnd = s.bufA.duration;
      src.connect(s.gA); src.start(0, offset);
      s.srcA = src;
    } else {
      for (const [k, buf, g] of [['srcA', s.bufA, s.gA], ['srcB', s.bufB, s.gB]]) {
        const src = s.ctx.createBufferSource();
        src.buffer = buf; src.loop = true; src.loopEnd = buf.duration;
        src.connect(g); src.start(0, offset);
        s[k] = src;
      }
    }
    s.startedAt = s.ctx.currentTime - offset;
  };
  const ensureCtx = () => {
    const s = st.current;
    if (!s.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      s.ctx = new Ctx();
      s.gA = s.ctx.createGain(); s.gB = s.ctx.createGain();
      s.gA.connect(s.ctx.destination); s.gB.connect(s.ctx.destination);
      const isSingle = singleTrack || !b;
      if (isSingle) {
        s.gA.gain.value = 1;
        s.gB.gain.value = 0;
      } else {
        const g = gainsFor(which); s.gA.gain.value = g.a; s.gB.gain.value = g.b;
      }
    }
    if (s.ctx.state === 'suspended') s.ctx.resume();
    return s.ctx;
  };

  // new buffers (e.g. after a slider change): keep the playhead where it is
  useEffect(() => {
    const s = st.current;
    if (!s.ctx) return;
    const p = position();
    s.bufA = makeBuffer(s.ctx, a);
    s.bufB = b ? makeBuffer(s.ctx, b) : s.bufA;
    if (s.playing) startAt(Math.min(p, Math.max(0, dur - 0.01)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b]);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const mid = h / 2, n = peaksA.min.length;
    const paint = (pk, color) => {
      g.fillStyle = color;
      for (let i = 0; i < n; i++) {
        const x = (i / n) * w, y1 = mid - pk.max[i] * mid * 0.95, y2 = mid - pk.min[i] * mid * 0.95;
        g.fillRect(x, y1, Math.max(1, w / n), Math.max(1, y2 - y1));
      }
    };
    if (singleTrack || !b) {
      paint(peaksA, 'rgba(14, 165, 233, 0.8)');
    } else {
      paint(peaksA, 'rgba(100, 116, 139, 0.45)');
      paint(peaksB, 'rgba(13, 148, 136, 0.7)');
    }
    const px = (position() / dur) * w;
    g.fillStyle = '#ef4444';
    g.fillRect(px, 0, 2, h);
  }, [peaksA, peaksB, dur, singleTrack, b]);

  useEffect(() => { draw(); }, [draw, a, b]);
  useEffect(() => {
    if (!playing) return undefined;
    let id;
    const loop = () => { setPos(position()); draw(); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, draw]);
  useEffect(() => () => { const s = st.current; stopSources(); if (s.ctx) s.ctx.close(); }, []);

  function togglePlay() {
    const s = st.current;
    const ctx = ensureCtx();
    if (!s.bufA) { s.bufA = makeBuffer(ctx, a); s.bufB = makeBuffer(ctx, b); }
    if (s.playing) { s.offset = position(); s.playing = false; stopSources(); setPlaying(false); setPos(s.offset); draw(); }
    else { startAt(s.offset); s.playing = true; setPlaying(true); }
  }
  function choose(w) {
    setWhich(w);
    const s = st.current;
    if (!s.ctx) return;
    const t = s.ctx.currentTime, g = gainsFor(w);
    for (const [node, target] of [[s.gA, g.a], [s.gB, g.b]]) {
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(node.gain.value, t);
      node.gain.linearRampToValueAtTime(target, t + CROSSFADE_SECONDS);
    }
  }
  function seek(sec) {
    const s = st.current;
    const t = Math.min(Math.max(0, sec), Math.max(0, dur - 0.01));
    s.offset = t; setPos(t);
    if (s.playing) startAt(t);
    draw();
  }
  const onKey = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'a' || e.key === 'A') choose('a');
    else if (e.key === 'b' || e.key === 'B') choose('b');
  };

  return (
    <div className="ab-player" role="group" aria-label="A/B comparison player" onKeyDown={onKey}>
      <div className="waveform-container">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Waveform comparison: grey is ${labelA}, teal is ${labelB}`}
          style={{ width: '100%', height: 96, display: 'block', cursor: 'pointer' }}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * dur); }}
        />
      </div>

      <div className="ab-scrub">
        <input
          type="range"
          aria-label="Playhead position"
          min="0"
          max={dur}
          step="0.01"
          value={pos}
          onChange={(e) => seek(+e.target.value)}
        />
        <div className="ab-time-row">
          <span>{fmtDuration(pos)}</span>
          <span>{fmtDuration(dur)}</span>
        </div>
      </div>

      <div className="ab-controls">
        <button
          onClick={togglePlay}
          className="btn-primary"
          aria-label={playing ? 'Pause audio' : 'Play audio'}
          style={{ minWidth: '95px' }}
        >
          {playing ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              Pause
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Play
            </>
          )}
        </button>

        {singleTrack || !b ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', color: 'var(--ink)' }}>
            <span className="dot dot-a" />
            <span><strong>Audio Source:</strong> {labelA}</span>
          </div>
        ) : (
          <div className="ab-switch-group">
            <button
              className={`btn-a ${which === 'a' ? 'active' : ''}`}
              aria-pressed={which === 'a'}
              onClick={() => choose('a')}
            >
              <span className="dot dot-a" />
              <strong>A:</strong> {labelA}
            </button>
            <button
              className={`btn-b ${which === 'b' ? 'active' : ''}`}
              aria-pressed={which === 'b'}
              onClick={() => choose('b')}
            >
              <span className="dot dot-b" />
              <strong>B:</strong> {labelB}
            </button>
          </div>
        )}
      </div>

      <p className="hint" style={{ marginTop: '10px', fontSize: '0.82rem' }}>
        {singleTrack || !b ? (
          <>⌨️ Press <kbd style={{ padding: '2px 5px', borderRadius: '4px', background: 'var(--panel)', border: '1px solid var(--line)', fontFamily: 'monospace' }}>Space</kbd> to play/pause &bull; Click or drag waveform to seek.</>
        ) : (
          <>⌨️ Press <kbd style={{ padding: '2px 5px', borderRadius: '4px', background: 'var(--panel)', border: '1px solid var(--line)', fontFamily: 'monospace' }}>Space</kbd> to play/pause &bull; <kbd style={{ padding: '2px 5px', borderRadius: '4px', background: 'var(--panel)', border: '1px solid var(--line)', fontFamily: 'monospace' }}>A</kbd> / <kbd style={{ padding: '2px 5px', borderRadius: '4px', background: 'var(--panel)', border: '1px solid var(--line)', fontFamily: 'monospace' }}>B</kbd> for instant seamless crossfade (both matched to -20 LUFS).</>
        )}
      </p>
    </div>
  );
}
