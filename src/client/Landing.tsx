import React, { useState } from 'react';
import type { AuthConfig } from './auth';
import { googleSignIn, devSignIn } from './auth';

interface LandingProps {
  config: AuthConfig;
  onSignedIn: () => void;
}

export function Landing({ config, onSignedIn }: LandingProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleStart = () => {
    setBusy(true);
    setError(null);
    googleSignIn(config.googleClientId).then((result) => {
      setBusy(false);
      if (result.ok) {
        onSignedIn();
      } else {
        setError(result.error);
      }
    });
  };

  const handleDevSignIn = () => {
    setBusy(true);
    setError(null);
    devSignIn('dev@local', 'Developer').then(() => {
      setBusy(false);
      onSignedIn();
    }).catch(() => {
      setBusy(false);
      setError('Dev sign-in failed');
    });
  };

  return (
    <div style={{
      minHeight: '100vh',
      maxHeight: '100vh',
      overflowY: 'auto',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: 'var(--font-ui)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Nav */}
      <nav style={{
        height: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-6)',
        maxWidth: 720,
        width: '100%',
        margin: '0 auto',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text)', letterSpacing: '-0.01em' }}>
          Tessera
        </span>
        <button
          type="button"
          onClick={handleStart}
          disabled={busy}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--accent)',
            fontSize: '13px',
            cursor: busy ? 'not-allowed' : 'pointer',
            padding: '4px 0',
            fontFamily: 'var(--font-ui)',
          }}
        >
          Sign in
        </button>
      </nav>

      {/* Hero */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        maxWidth: 720,
        width: '100%',
        margin: '0 auto',
        padding: '64px var(--space-6) 48px',
      }}>
        <h1 style={{
          fontSize: '52px',
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: '-0.025em',
          color: 'var(--text)',
          margin: '0 0 var(--space-4) 0',
        }}>
          Spreadsheets that always agree.
        </h1>
        <p style={{
          fontSize: '16px',
          lineHeight: 1.5,
          color: 'var(--muted)',
          margin: '0 0 var(--space-6) 0',
          maxWidth: 540,
        }}>
          Real-time collaboration on a formula engine that recalculates only what changed.
        </p>
        <button
          type="button"
          onClick={handleStart}
          disabled={busy}
          style={{
            background: 'var(--accent)',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 'var(--radius)',
            padding: '0 20px',
            height: 40,
            fontSize: '14px',
            fontWeight: 500,
            fontFamily: 'var(--font-ui)',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          Start working
        </button>
        {error && (
          <p style={{
            fontSize: '13px',
            color: 'var(--danger)',
            margin: 'var(--space-3) 0 0 0',
          }}>
            {error}
          </p>
        )}

        {/* Three short text blocks in a row (stack under 720px) */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-6)',
          marginTop: 64,
          flexWrap: 'wrap',
          width: '100%',
        }}>
          <div style={{ flex: '1 1 180px', minWidth: 180, fontSize: '14px', color: 'var(--muted)', lineHeight: 1.5 }}>
            Recalculates only what changed
          </div>
          <div style={{ flex: '1 1 180px', minWidth: 180, fontSize: '14px', color: 'var(--muted)', lineHeight: 1.5 }}>
            Every collaborator converges to the same state
          </div>
          <div style={{ flex: '1 1 180px', minWidth: 180, fontSize: '14px', color: 'var(--muted)', lineHeight: 1.5 }}>
            Share by link, control who can edit
          </div>
        </div>

        {config.devLogin && (
          <button
            type="button"
            onClick={handleDevSignIn}
            disabled={busy}
            style={{
              marginTop: 48,
              background: 'transparent',
              border: 'none',
              fontSize: '12px',
              color: 'var(--muted)',
              cursor: busy ? 'not-allowed' : 'pointer',
              padding: 0,
              textDecoration: 'underline',
              fontFamily: 'var(--font-ui)',
            }}
          >
            Dev sign-in
          </button>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        padding: 'var(--space-4) var(--space-6)',
        maxWidth: 720,
        width: '100%',
        margin: '0 auto',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
          Tessera
        </div>
      </footer>
    </div>
  );
}
