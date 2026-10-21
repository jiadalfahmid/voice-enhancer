import React, { useMemo, useState } from 'react';
import ABPlayer from './ABPlayer.jsx';
import { windowOf, matchLoudness, PREVIEW_SECONDS, fmtDuration } from '../studio/audioTools.js';
import { versionTitle } from '../studio/useStudio.js';

// A/B between any two stored versions: the same 20 s window of each, loudness-matched.
export default function CompareView({ store, versions, aId, bId, setA, setB }) {
  const ok = versions.filter((v) => v.status === 'ok');
  const a = aId ? store.get(aId) : null;
  const b = bId ? store.get(bId) : null;
  const [start, setStart] = useState(0);
  const ready = a?.audio && b?.audio && a.id !== b.id;
  const rate = a?.sampleRate;
  const dur = a ? a.length / a.sampleRate : 0;
  const maxStart = Math.max(0, Math.floor(dur - PREVIEW_SECONDS));
  const s = Math.min(start, maxStart);

  const wins = useMemo(() => {
    if (!ready) return null;
    return {
      a: matchLoudness(windowOf(a.audio.channels, rate, s), rate),
      b: matchLoudness(windowOf(b.audio.channels, rate, s), rate),
    };
  }, [ready, a, b, rate, s]);

  const pick = (value, set, label) => (
    <label className="field">{label}
      <select value={value || ''} onChange={(e) => set(e.target.value || null)}>
        <option value="">Choose a version</option>
        {ok.map((v) => <option key={v.id} value={v.id}>{versionTitle(store, v)}</option>)}
      </select>
    </label>
  );

  return (
    <section aria-labelledby="cmp-h" className="panel">
      <h2 id="cmp-h">Compare</h2>
      <div className="pair">{pick(aId, setA, 'Version A')}{pick(bId, setB, 'Version B')}</div>
      {!ready && <p className="hint">Pick two different versions to hear them side by side. Both are loudness-matched, so louder never sounds better.</p>}
      {ready && wins && (
        <>
          <ABPlayer key={`${a.id}-${b.id}-${s}`} a={wins.a} b={wins.b} sampleRate={rate} labelA={versionTitle(store, a)} labelB={versionTitle(store, b)} />
          <label className="field">Listen from {fmtDuration(s)} (plays {PREVIEW_SECONDS} s on loop)
            <input type="range" min="0" max={maxStart} value={s} onChange={(e) => setStart(+e.target.value)} />
          </label>
        </>
      )}
    </section>
  );
}
