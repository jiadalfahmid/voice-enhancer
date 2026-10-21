import React, { useMemo, useState } from 'react';
import ABPlayer from './ABPlayer.jsx';
import { windowOf, matchLoudness, PREVIEW_SECONDS, fmtDuration } from '../studio/audioTools.js';
import { versionTitle } from '../studio/useStudio.js';

// A/B between any two stored versions: the same 20 s window of each, loudness-matched.
// When only the original recording exists, renders an instant single-track preview player.
export default function CompareView({ store, versions, aId, bId, setA, setB }) {
  const ok = versions.filter((v) => v.status === 'ok');
  const hasResults = ok.some((v) => v.kind === 'result');
  const [start, setStart] = useState(0);

  const origVersion = versions.find((v) => v.kind === 'original');
  const a = aId ? store.get(aId) : (origVersion || ok[0] || null);
  const b = bId ? store.get(bId) : null;
  const ready = hasResults && a?.audio && b?.audio && a.id !== b.id;

  const target = ready ? a : (a || origVersion || ok[0]);
  const rate = target?.sampleRate;
  const dur = target ? target.length / target.sampleRate : 0;
  const maxStart = Math.max(0, Math.floor(dur - PREVIEW_SECONDS));
  const s = Math.min(start, maxStart);

  const wins = useMemo(() => {
    if (!target?.audio || !rate) return null;
    if (ready && a?.audio && b?.audio) {
      return {
        a: matchLoudness(windowOf(a.audio.channels, rate, s), rate),
        b: matchLoudness(windowOf(b.audio.channels, rate, s), rate),
      };
    }
    const win = matchLoudness(windowOf(target.audio.channels, rate, s), rate);
    return { a: win, b: null };
  }, [ready, a, b, target, rate, s]);

  const pick = (value, set, label) => (
    <label className="field">{label}
      <select value={value || ''} onChange={(e) => set(e.target.value || null)}>
        <option value="">Choose a version</option>
        {ok.map((v) => <option key={v.id} value={v.id}>{versionTitle(store, v)}</option>)}
      </select>
    </label>
  );

  if (!hasResults && target?.audio && wins) {
    return (
      <section aria-labelledby="cmp-h" className="panel">
        <div className="panel-header">
          <h2 id="cmp-h">Input Audio Preview</h2>
          <span className="badge tag">Single Track Mode</span>
        </div>
        <p className="hint">
          Audition your recording and inspect the waveform below. Enhance with any model below to unlock side-by-side A/B comparison and instant crossfading.
        </p>
        <ABPlayer
          key={`single-${target.id}-${s}`}
          a={wins.a}
          sampleRate={rate}
          labelA={versionTitle(store, target)}
          singleTrack
        />
        {dur > PREVIEW_SECONDS && (
          <label className="field" style={{ marginTop: '14px' }}>
            <span>Preview window offset: <strong>{fmtDuration(s)}</strong> (plays {PREVIEW_SECONDS} s seamless loop)</span>
            <input type="range" min="0" max={maxStart} value={s} onChange={(e) => setStart(+e.target.value)} />
          </label>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="cmp-h" className="panel">
      <div className="panel-header">
        <h2 id="cmp-h">A/B Audition &amp; Comparison Workspace</h2>
        <span className="badge recommended">Loudness Matched &bull; -20 LUFS</span>
      </div>
      <div className="pair">{pick(aId, setA, 'Version A')}{pick(bId, setB, 'Version B')}</div>
      {!ready && (
        <p className="hint" style={{ marginTop: '10px' }}>
          Select any two versions above to audition them side by side. Both are loudness-matched to -20 LUFS so louder never tricks your ears.
        </p>
      )}
      {ready && wins && (
        <>
          <ABPlayer
            key={`${a.id}-${b.id}-${s}`}
            a={wins.a}
            b={wins.b}
            sampleRate={rate}
            labelA={versionTitle(store, a)}
            labelB={versionTitle(store, b)}
          />
          {dur > PREVIEW_SECONDS && (
            <label className="field" style={{ marginTop: '14px' }}>
              <span>Preview window offset: <strong>{fmtDuration(s)}</strong> (plays {PREVIEW_SECONDS} s seamless loop)</span>
              <input type="range" min="0" max={maxStart} value={s} onChange={(e) => setStart(+e.target.value)} />
            </label>
          )}
        </>
      )}
    </section>
  );
}
