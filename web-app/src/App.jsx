import React, { useEffect, useState } from 'react';
import { detectCapabilities } from './audio/capabilities.js';
import EnhancerUI from './components/EnhancerUI.jsx';
import Studio from './components/Studio.jsx';
import HelpView from './components/HelpView.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './studio.css';

const caps = detectCapabilities();
const fmt = (v) => (v === true ? 'yes' : v === false ? 'no' : String(v));

// The studio is the default. Help is at #help. The earlier single-engine app stays available at #classic.
export default function App() {
  const [route, setRoute] = useState(() => window.location.hash);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (route === '#help') {
    return <HelpView onBack={() => { window.location.hash = ''; }} />;
  }

  if (route === '#classic') {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Voice Enhancer (classic)</h1>
        <EnhancerUI />
        <p><a href="#">Back to the studio</a></p>
      </main>
    );
  }

  return (
    <>
      <ErrorBoundary>
        <Studio />
      </ErrorBoundary>
      <details className="studio" style={{ paddingTop: 0 }}>
        <summary>Device &amp; legal details</summary>
        <p className="hint">{caps.crossOriginIsolated ? 'Cross-origin isolated: multi-thread ready.' : 'Not cross-origin isolated: single-thread mode.'}</p>
        <p className="hint">{['wasmSimd', 'audioWorklet', 'webgpu'].map((k) => `${k}: ${fmt(caps[k])}`).join(', ')}</p>
        <p className="hint">
          <a href="#help">User Guide</a> &bull;{' '}
          <a href="/privacy.html">Privacy Notice</a> &bull;{' '}
          <a href="/THIRD-PARTY-NOTICES.txt">Third-party licenses</a> &bull;{' '}
          <a href="#classic">Classic view</a>
        </p>
      </details>
    </>
  );
}
