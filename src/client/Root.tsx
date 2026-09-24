import React, { useState, useEffect, useCallback } from 'react';
import { currentRoute, navigate, subscribeRoute, type Route } from './router';
import { fetchConfig, fetchMe, fetchSheets, createSheet, fetchSheetInfo, signOut, type AuthConfig, type AuthUser, type SheetEntry } from './auth';
import { Landing } from './Landing';
import { AuthPanel } from './AuthPanel';
import { SheetPage } from './SheetPage';
import { disconnectSocket } from './socket';

type AppState =
  | { page: 'loading' }
  | { page: 'landing'; config: AuthConfig }
  | { page: 'sheet'; sheetId: string; config: AuthConfig; user: AuthUser; recentSheets: SheetEntry[] }
  | { page: 'auth'; sheetId: string; mode: 'signin_required' | 'forbidden'; config: AuthConfig; user: AuthUser | null }
  | { page: '404' };

export function Root() {
  const [state, setState] = useState<AppState>({ page: 'loading' });

  const boot = useCallback(async () => {
    try {
      const [config, user] = await Promise.all([fetchConfig(), fetchMe()]);
      const route = currentRoute();

      if (route.page === '404') {
        setState({ page: '404' });
        return;
      }

      if (route.page === 'landing') {
        if (user) {
          // Signed in at landing: redirect to most recent sheet or create new
          const sheets = await fetchSheets();
          if (sheets.length > 0) {
            const sorted = sheets.sort((a, b) => b.updatedAt - a.updatedAt);
            navigate({ page: 'sheet', sheetId: sorted[0]!.id }, true);
            setState({ page: 'sheet', sheetId: sorted[0]!.id, config, user, recentSheets: sheets });
          } else {
            const newId = await createSheet();
            navigate({ page: 'sheet', sheetId: newId }, true);
            setState({ page: 'sheet', sheetId: newId, config, user, recentSheets: [] });
          }
        } else {
          setState({ page: 'landing', config });
        }
        return;
      }

      // route.page === 'sheet'
      const sheetId = route.sheetId;
      if (user) {
        // Check access
        const result = await fetchSheetInfo(sheetId);
        if (result.info) {
          const sheets = await fetchSheets();
          setState({ page: 'sheet', sheetId, config, user, recentSheets: sheets });
        } else if (result.error === 'forbidden') {
          setState({ page: 'auth', sheetId, mode: 'forbidden', config, user });
        } else {
          setState({ page: 'auth', sheetId, mode: 'signin_required', config, user: null });
        }
      } else {
        // Not signed in: check if public
        const result = await fetchSheetInfo(sheetId);
        if (result.info) {
          setState({ page: 'sheet', sheetId, config, user: { email: '', name: 'Guest' }, recentSheets: [] });
        } else if (result.error === 'signin_required') {
          setState({ page: 'auth', sheetId, mode: 'signin_required', config, user: null });
        } else {
          setState({ page: 'auth', sheetId, mode: 'signin_required', config, user: null });
        }
      }
    } catch {
      // Config fetch failed — probably not in auth mode, show sheet directly
      const route = currentRoute();
      if (route.page === 'sheet') {
        setState({ page: 'sheet', sheetId: route.sheetId, config: { googleClientId: '', devLogin: false }, user: { email: '', name: '' }, recentSheets: [] });
      } else {
        setState({ page: 'landing', config: { googleClientId: '', devLogin: false } });
      }
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  // Listen for route changes
  useEffect(() => {
    return subscribeRoute(() => {
      boot();
    });
  }, [boot]);

  const handleSignedIn = useCallback(() => {
    boot();
  }, [boot]);

  const handleSignOut = useCallback(async () => {
    disconnectSocket();
    await signOut();
    navigate({ page: 'landing' }, true);
    // Re-boot after navigating
    const config = state.page === 'sheet' || state.page === 'auth' || state.page === 'landing'
      ? (state as { config: AuthConfig }).config
      : { googleClientId: '', devLogin: false };
    setState({ page: 'landing', config });
  }, [state]);

  const handleNewSheet = useCallback(async () => {
    try {
      const newId = await createSheet();
      navigate({ page: 'sheet', sheetId: newId });
      boot();
    } catch {
      // ignore
    }
  }, [boot]);

  const handleSwitchAccount = useCallback(async () => {
    disconnectSocket();
    await signOut();
    // Stay on the same path but re-boot as signed-out
    boot();
  }, [boot]);

  switch (state.page) {
    case 'loading':
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          fontFamily: 'var(--font-ui)',
          color: 'var(--muted)',
          fontSize: '13px',
        }}>
          Loading...
        </div>
      );

    case 'landing':
      return <Landing config={state.config} onSignedIn={handleSignedIn} />;

    case 'auth':
      return (
        <AuthPanel
          config={state.config}
          mode={state.mode}
          currentUser={state.user}
          onSignedIn={handleSignedIn}
          onSwitchAccount={handleSwitchAccount}
        />
      );

    case 'sheet':
      return (
        <SheetPage
          sheetId={state.sheetId}
          accountMenu={
            <AccountMenu
              user={state.user}
              recentSheets={state.recentSheets}
              onSignOut={handleSignOut}
              onNewSheet={handleNewSheet}
              onSelectSheet={(id) => {
                navigate({ page: 'sheet', sheetId: id });
              }}
            />
          }
        />
      );

    case '404':
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          fontFamily: 'var(--font-ui)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '48px', fontWeight: 600, color: 'var(--text)', margin: '0 0 var(--space-2) 0' }}>404</h1>
            <p style={{ fontSize: '14px', color: 'var(--muted)', margin: 0 }}>Page not found</p>
          </div>
        </div>
      );
  }
}

// ── Account menu (embedded in top-bar of sheet page) ──

function AccountMenu({
  user,
  recentSheets,
  onSignOut,
  onNewSheet,
  onSelectSheet,
}: {
  user: AuthUser;
  recentSheets: SheetEntry[];
  onSignOut: () => void;
  onNewSheet: () => void;
  onSelectSheet: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!user.email) return null; // Guest / no auth

  const initials = user.name
    ? user.name.split(' ').map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase()
    : user.email.slice(0, 2).toUpperCase();

  // Limit to 10 recent sheets
  const displayed = recentSheets.slice(0, 10);

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        title={`${user.name}\n${user.email}`}
        aria-label="Account menu"
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'var(--accent)',
          color: '#FFFFFF',
          border: 'none',
          fontSize: '11px',
          fontWeight: 600,
          fontFamily: 'var(--font-ui)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {initials}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 36,
          right: 0,
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-pop)',
          width: 220,
          padding: 'var(--space-2) 0',
          fontSize: '13px',
          zIndex: 1000,
        }}>
          <div style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>{user.name}</div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{user.email}</div>
          </div>

          <button
            type="button"
            onClick={() => { setOpen(false); onNewSheet(); }}
            style={menuItemStyle}
          >
            New sheet
          </button>

          {displayed.length > 0 && (
            <>
              <div style={{ height: 1, background: 'var(--border)', margin: 'var(--space-1) 0' }} />
              <div style={{ padding: 'var(--space-1) var(--space-3)', fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>
                Recent
              </div>
              {displayed.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setOpen(false); onSelectSheet(s.id); }}
                  style={menuItemStyle}
                >
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {s.title || 'Untitled sheet'}
                  </span>
                </button>
              ))}
            </>
          )}

          <div style={{ height: 1, background: 'var(--border)', margin: 'var(--space-1) 0' }} />

          <button
            type="button"
            onClick={() => { setOpen(false); onSignOut(); }}
            style={menuItemStyle}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: 'var(--space-2) var(--space-3)',
  border: 'none',
  background: 'transparent',
  color: 'var(--text)',
  fontFamily: 'var(--font-ui)',
  fontSize: '13px',
  cursor: 'pointer',
  lineHeight: '20px',
};
