import React, { useState } from 'react';
import { VOICE_EQ_PRESETS } from '../audio/voice-equalizer.js';
import { versionTitle } from '../studio/useStudio.js';

export default function VoicePolishPanel({ store, versionId, onApply, onClose }) {
  const target = store.get(versionId);
  const title = target ? versionTitle(store, target) : 'Version';

  const [presetKey, setPresetKey] = useState('podcast');
  const [balancerEnabled, setBalancerEnabled] = useState(true);
  const [balancerStrength, setBalancerStrength] = useState(75);

  const [eqEnabled, setEqEnabled] = useState(true);
  const [hpf, setHpf] = useState(80);
  const [warmth, setWarmth] = useState(1.5);
  const [demud, setDemud] = useState(-2.0);
  const [presence, setPresence] = useState(2.5);
  const [air, setAir] = useState(2.0);

  const applyPreset = (key) => {
    setPresetKey(key);
    if (key !== 'custom' && VOICE_EQ_PRESETS[key]) {
      const p = VOICE_EQ_PRESETS[key];
      setHpf(p.hpf);
      setWarmth(p.warmth);
      setDemud(p.demud);
      setPresence(p.presence);
      setAir(p.air);
    }
  };

  const onSliderChange = (setter, val) => {
    setter(val);
    setPresetKey('custom');
  };

  const handleApply = () => {
    const label = `Polish: ${presetKey !== 'custom' ? (VOICE_EQ_PRESETS[presetKey]?.label || presetKey) : 'Custom EQ'}${balancerEnabled ? ' + Leveler' : ''}`;
    onApply(
      versionId,
      {
        balancer: {
          enabled: balancerEnabled,
          strength: balancerStrength / 100,
        },
        equalizer: {
          enabled: eqEnabled,
          hpf,
          warmth,
          demud,
          presence,
          air,
        },
      },
      label
    );
    onClose();
  };

  const getDbBadgeClass = (val) => {
    if (val > 0) return 'eq-val-badge positive';
    if (val < 0) return 'eq-val-badge negative';
    return 'eq-val-badge zero';
  };

  return (
    <div className="polish-panel panel" role="region" aria-label={`Voice Polish for ${title}`}>
      <div className="polish-header">
        <div>
          <h3 className="polish-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
              <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
            </svg>
            Voice Polish: Balancer &amp; 5-Band Equalizer
          </h3>
          <p className="hint" style={{ margin: '2px 0 0' }}>Polishing <strong>{title}</strong> with dynamic speech leveling and parametric EQ.</p>
        </div>
        <button className="link" onClick={onClose} aria-label="Close voice polish">✕ Close</button>
      </div>

      {/* Preset Chips */}
      <div>
        <label className="hint" style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}>Quick Voice Profile Presets:</label>
        <div className="chip-group">
          {Object.entries(VOICE_EQ_PRESETS).map(([key, p]) => (
            <button
              key={key}
              type="button"
              className={`chip ${presetKey === key ? 'active' : ''}`}
              onClick={() => applyPreset(key)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className={`chip ${presetKey === 'custom' ? 'active' : ''}`}
            onClick={() => setPresetKey('custom')}
          >
            Custom
          </button>
        </div>
      </div>

      {/* Voice Balancer Section */}
      <div style={{ background: 'var(--panel-subtle)', borderRadius: 'var(--radius-md)', padding: '14px 16px', margin: '14px 0', border: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={balancerEnabled}
              onChange={(e) => setBalancerEnabled(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
            />
            Speech-Gated Dynamic Balancer (Auto-Leveler)
          </label>
          {balancerEnabled && (
            <span className="badge browser-ready">{balancerStrength}% Strength</span>
          )}
        </div>
        <p className="hint" style={{ margin: '4px 0 8px 24px' }}>
          Smooths volume fluctuations across quiet and loud phrases without noise-pumping during speech pauses.
        </p>
        {balancerEnabled && (
          <div style={{ paddingLeft: '24px', marginTop: '6px' }}>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={balancerStrength}
              onChange={(e) => setBalancerStrength(+e.target.value)}
            />
          </div>
        )}
      </div>

      {/* 5-Band Equalizer Section */}
      <div style={{ background: 'var(--panel-subtle)', borderRadius: 'var(--radius-md)', padding: '14px 16px', margin: '14px 0', border: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={eqEnabled}
              onChange={(e) => setEqEnabled(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
            />
            5-Band Voice Equalizer
          </label>
          {eqEnabled && (
            <span className="badge tag">Parametric Biquad</span>
          )}
        </div>

        {eqEnabled && (
          <div className="eq-grid">
            <div className="eq-card">
              <div className="eq-card-header">
                <span>Low-Cut HPF</span>
                <span className="eq-val-badge zero">{hpf > 0 ? `${hpf} Hz` : 'Off'}</span>
              </div>
              <select value={hpf} onChange={(e) => onSliderChange(setHpf, +e.target.value)} style={{ marginTop: '4px' }}>
                <option value={0}>Off</option>
                <option value={80}>80 Hz (Standard)</option>
                <option value={100}>100 Hz (Aggressive)</option>
                <option value={120}>120 Hz (High Cut)</option>
              </select>
              <small className="hint">Plosives &amp; mic rumble</small>
            </div>

            <div className="eq-card">
              <div className="eq-card-header">
                <span>Warmth (220 Hz)</span>
                <span className={getDbBadgeClass(warmth)}>{warmth > 0 ? `+${warmth}` : warmth} dB</span>
              </div>
              <input
                type="range"
                min="-6"
                max="6"
                step="0.5"
                value={warmth}
                onChange={(e) => onSliderChange(setWarmth, +e.target.value)}
              />
              <small className="hint">Chest body / boom</small>
            </div>

            <div className="eq-card">
              <div className="eq-card-header">
                <span>De-Mud (600 Hz)</span>
                <span className={getDbBadgeClass(demud)}>{demud > 0 ? `+${demud}` : demud} dB</span>
              </div>
              <input
                type="range"
                min="-6"
                max="6"
                step="0.5"
                value={demud}
                onChange={(e) => onSliderChange(setDemud, +e.target.value)}
              />
              <small className="hint">Boxy room resonance</small>
            </div>

            <div className="eq-card">
              <div className="eq-card-header">
                <span>Presence (3 kHz)</span>
                <span className={getDbBadgeClass(presence)}>{presence > 0 ? `+${presence}` : presence} dB</span>
              </div>
              <input
                type="range"
                min="-6"
                max="6"
                step="0.5"
                value={presence}
                onChange={(e) => onSliderChange(setPresence, +e.target.value)}
              />
              <small className="hint">Speech articulation</small>
            </div>

            <div className="eq-card">
              <div className="eq-card-header">
                <span>Air (10 kHz)</span>
                <span className={getDbBadgeClass(air)}>{air > 0 ? `+${air}` : air} dB</span>
              </div>
              <input
                type="range"
                min="-6"
                max="6"
                step="0.5"
                value={air}
                onChange={(e) => onSliderChange(setAir, +e.target.value)}
              />
              <small className="hint">High sheen &amp; clarity</small>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '16px', alignItems: 'center' }}>
        <button className="btn-primary" onClick={handleApply}>
          ✨ Apply as New Stage Version
        </button>
        <button className="link" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
