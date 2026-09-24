import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Grid, type GridHandle } from './Grid';
import { FormulaBar } from './FormulaBar';
import { toCellId, type NavState } from './nav';
import { useMeta } from './store';
import { sendSelect, getMyU, dropConnection } from './socket';
import type { User } from '../shared/protocol';

// ── Debug flag ──
const isDebug = typeof window !== 'undefined' && window.location.search.includes('debug');

export function App() {
  const [nav, setNav] = useState<NavState>({ col: 0, row: 0, mode: 'navigate' });
  const [editBuffer, setEditBuffer] = useState('');
  const gridRef = useRef<GridHandle>(null);
  const meta = useMeta();

  const handleNavChange = useCallback((n: NavState, buf: string) => {
    setNav(n);
    setEditBuffer(buf);
  }, []);

  const handleRefocusGrid = useCallback(() => {
    gridRef.current?.refocus();
  }, []);

  const cellId = toCellId(nav.col, nav.row);

  // Send SELECT on selection change
  const prevCellRef = useRef<string>(cellId);
  useEffect(() => {
    if (prevCellRef.current !== cellId) {
      prevCellRef.current = cellId;
      sendSelect(cellId);
    }
  }, [cellId]);

  // Also send initial selection
  useEffect(() => {
    sendSelect(cellId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-ui)',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <TopBar users={meta.users} />
      {meta.connection === 'reconnecting' && (
        <ReconnectingBanner pendingCount={meta.pendingCount} />
      )}
      {isDebug && (
        <div style={{ padding: '0 var(--space-2)', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={dropConnection}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '12px',
              padding: '2px 8px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--bg)',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            Drop connection
          </button>
        </div>
      )}
      <FormulaBar
        cellId={cellId}
        cellEditing={nav.mode === 'edit'}
        cellEditBuffer={editBuffer}
        onRefocusGrid={handleRefocusGrid}
      />
      <Grid ref={gridRef} onNavChange={handleNavChange} />
      <ToastContainer toasts={meta.toasts} />
    </div>
  );
}

// ── Top bar with avatars ──

function TopBar({ users }: { users: User[] }) {
  const myU = getMyU();
  return (
    <div
      style={{
        height: 44,
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-4)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        flexShrink: 0,
        gap: 'var(--space-2)',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '14px', flex: 1 }}>
        Spreadsheet
      </div>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {users.filter(u => u.u !== myU).map(u => (
          <Avatar key={u.u} user={u} />
        ))}
      </div>
    </div>
  );
}

function Avatar({ user }: { user: User }) {
  const initials = user.name.slice(0, 2).toUpperCase();
  return (
    <div
      title={user.name}
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: user.color,
        color: 'var(--bg)',
        fontSize: '11px',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

// ── Reconnecting banner ──

function ReconnectingBanner({ pendingCount }: { pendingCount: number }) {
  return (
    <div
      style={{
        height: 24,
        lineHeight: '24px',
        fontSize: '12px',
        textAlign: 'center',
        background: 'var(--surface)',
        color: 'var(--muted)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      Reconnecting{pendingCount > 0 ? ` (${pendingCount} queued edit${pendingCount > 1 ? 's' : ''})` : ''}
    </div>
  );
}

// ── Toast container ──

function ToastContainer({ toasts }: { toasts: Array<{ id: number; text: string }> }) {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'var(--space-4)',
        left: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        zIndex: 100,
      }}
    >
      {toasts.map(t => (
        <div
          key={t.id}
          style={{
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--text)',
            color: 'var(--bg)',
            fontSize: '13px',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-pop)',
            maxWidth: 320,
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
