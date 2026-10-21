import React from 'react';
import { detectCapabilities } from './audio/capabilities.js';
import EnhancerUI from './components/EnhancerUI.jsx';
import Studio from './components/Studio.jsx';
import './studio.css';

const caps = detectCapabilities();
const fmt = (v) => (v === true ? 'yes' : v === false ? 'no' : String(v));

// The studio is the default. The earlier single-engine app stays available at #classic.
export default function App() {
  if (window.location.hash === '#classic') {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Voice Enhancer (classic)</h1>
        <EnhancerUI />
        <p><a href="#" onClick={() => setTimeout(() => window.location.reload())}>Back to the studio</a></p>
      </main>
    );
  }
  return (
    <>
      <Studio />
      <details className="studio" style={{ paddingTop: 0 }}>
        <summary>Device details</summary>
        <p className="hint">{caps.crossOriginIsolated ? 'Cross-origin isolated: multi-thread ready.' : 'Not cross-origin isolated: single-thread mode.'}</p>
        <p className="hint">{['wasmSimd', 'audioWorklet', 'webgpu'].map((k) => `${k}: ${fmt(caps[k])}`).join(', ')}</p>
        <p className="hint"><a href="/THIRD-PARTY-NOTICES.txt">Third-party licenses</a> | <a href="#classic" onClick={() => setTimeout(() => window.location.reload())}>Classic view</a></p>
      </details>
    </>
  );
}
