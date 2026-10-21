import React, { useEffect, useState } from 'react';
import { detectCapabilities } from './audio/capabilities.js';
import Studio from './components/Studio.jsx';
import HelpView from './components/HelpView.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './studio.css';

const caps = detectCapabilities();
const fmt = (v) => (v === true ? 'yes' : v === false ? 'no' : String(v));

// The studio is the default. Help is at #help.
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
          <a href="/privacy.html" rel="privacy-policy">Privacy Notice</a> &bull;{' '}
          <a href="/THIRD-PARTY-NOTICES.txt" rel="license">Third-party licenses</a>
        </p>
      </details>
    </>
  );
}
