import React, { useState } from 'react';
import type { AuthConfig, AuthUser } from './auth';
import { googleSignIn, devSignIn } from './auth';

interface AuthPanelProps {
  config: AuthConfig;
  mode: 'signin_required' | 'forbidden';
  currentUser: AuthUser | null;
  onSignedIn: () => void;
  onSwitchAccount: () => void;
}

export function AuthPanel({ config, mode, currentUser, onSignedIn, onSwitchAccount }: AuthPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleGoogleSignIn = () => {
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

  if (mode === 'forbidden' && currentUser) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        fontFamily: 'var(--font-ui)',
      }}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 var(--space-3) 0', color: 'var(--text)' }}>
            You don't have access
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--muted)', margin: '0 0 var(--space-4) 0' }}>
            Signed in as {currentUser.email}
          </p>
          <button
            type="button"
            className="btn-bordered"
            onClick={onSwitchAccount}
          >
            Switch account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      fontFamily: 'var(--font-ui)',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 var(--space-3) 0', color: 'var(--text)' }}>
          Sign in to open this sheet
        </h2>
        <button
          type="button"
          onClick={handleGoogleSignIn}
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
          Sign in with Google
        </button>
        {config.devLogin && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <button
              type="button"
              onClick={handleDevSignIn}
              disabled={busy}
              className="btn-text"
              style={{ fontSize: '12px', color: 'var(--muted)' }}
            >
              Dev sign-in
            </button>
          </div>
        )}
        {error && (
          <p style={{
            fontSize: '13px',
            color: 'var(--danger)',
            margin: 'var(--space-3) 0 0 0',
          }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
