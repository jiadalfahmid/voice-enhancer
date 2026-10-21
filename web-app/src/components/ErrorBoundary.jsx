import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Unhandled interface error in ClearVoice Studio:', error, errorInfo);
  }

  componentDidMount() {
    this.handleUnhandledRejection = (event) => {
      console.error('Unhandled promise rejection:', event.reason);
    };
    this.handleWindowError = (event) => {
      if (event.error) {
        console.error('Window error caught:', event.error);
      }
    };
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.addEventListener('error', this.handleWindowError);
  }

  componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.removeEventListener('error', this.handleWindowError);
  }

  handleReload = () => {
    window.location.hash = '';
    window.location.reload();
  };

  handleCopyDetails = () => {
    const errorText = this.state.error
      ? `${this.state.error.name || 'Error'}: ${this.state.error.message}\n\nStack:\n${this.state.error.stack || 'No stack trace available'}`
      : 'Unknown error';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(errorText).then(() => {
        this.setState({ copied: true });
        setTimeout(() => this.setState({ copied: false }), 2500);
      }).catch(() => {});
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="studio" style={{ maxWidth: 640, margin: '3rem auto', padding: '0 1rem' }}>
          <div className="panel" role="alert" style={{ border: '1px solid var(--danger, #ef4444)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ color: 'var(--danger, #ef4444)', display: 'flex' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Something broke, your original file is still on your device. Reload</h2>
            </div>
            <p style={{ color: 'var(--muted, #94a3b8)', lineHeight: 1.6 }}>
              An unexpected error occurred while running the application. Your original audio file remains safe on your device.
            </p>
            <div style={{ display: 'flex', gap: '12px', margin: '1.5rem 0', flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={this.handleReload}>
                Reload
              </button>
              <button
                type="button"
                onClick={this.handleCopyDetails}
                style={{ padding: '8px 16px', background: 'var(--panel-subtle, #334155)', color: '#fff', border: '1px solid var(--border, #475569)', borderRadius: '6px', cursor: 'pointer' }}
              >
                {this.state.copied ? 'Copied!' : 'Copy details'}
              </button>
            </div>
            {this.state.error && (
              <details style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--muted, #94a3b8)' }}>
                <summary style={{ cursor: 'pointer' }}>Technical details</summary>
                <pre style={{ margin: '8px 0 0', padding: '10px', background: 'var(--panel-subtle, #0f172a)', borderRadius: '6px', overflowX: 'auto', color: '#f87171', whiteSpace: 'pre-wrap' }}>
                  {this.state.error.stack || this.state.error.message || String(this.state.error)}
                </pre>
              </details>
            )}
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
