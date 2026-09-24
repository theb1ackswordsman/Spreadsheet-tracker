import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Grid, type GridHandle } from './Grid';
import { FormulaBar } from './FormulaBar';
import { toCellId, type NavState } from './nav';
import { useMeta, addToast, setEvalMode } from './store';
import { sendSelect, getMyU, dropConnection } from './socket';
import { sendSampleData } from './sample';
import { isStressLoaded, sendStressData, clearStressData } from './stress';
import { PerformanceStrip } from './PerformanceStrip';
import type { User } from '../shared/protocol';
import type { Stats } from '../engine/types';

// ── Debug flag ──
const isDebug = typeof window !== 'undefined' && window.location.search.includes('debug');

export function App({ accountMenu }: { accountMenu?: React.ReactNode } = {}) {
  const [title, setTitle] = useState('Untitled spreadsheet');
  const [nav, setNav] = useState<NavState>({ col: 0, row: 0, mode: 'navigate' });
  const [editBuffer, setEditBuffer] = useState('');
  const [hintDismissed, setHintDismissed] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  const [stressBusy, setStressBusy] = useState(false);
  const stressLoaded = isStressLoaded();

  const handleStressClick = async () => {
    if (stressBusy) return;
    setStressBusy(true);
    try {
      if (stressLoaded) {
        await clearStressData();
      } else {
        await sendStressData();
      }
    } finally {
      setStressBusy(false);
    }
  };

  const gridRef = useRef<GridHandle>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
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

  // Global keydown for Shortcuts popover (Esc closes, ? opens when not typing in input)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && shortcutsOpen) {
        e.preventDefault();
        setShortcutsOpen(false);
        gridRef.current?.refocus();
      } else if (e.key === '?' && !shortcutsOpen) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setShortcutsOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcutsOpen]);

  // Outside click handler for Shortcuts popover
  useEffect(() => {
    if (!shortcutsOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        const btn = document.getElementById('btn-shortcuts');
        if (btn && btn.contains(e.target as Node)) return;
        setShortcutsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [shortcutsOpen]);

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
      <TopBar
        title={title}
        onTitleChange={setTitle}
        connection={meta.connection}
        users={meta.users}
        accountMenu={accountMenu}
      />
      {meta.connection === 'reconnecting' && (
        <ReconnectingBanner pendingCount={meta.pendingCount} />
      )}
      {isDebug && (
        <div style={{ padding: '0 var(--space-2)', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={dropConnection}
            className="btn-bordered"
            style={{ fontSize: '12px', padding: '2px 8px' }}
          >
            Drop connection
          </button>
        </div>
      )}
      <Toolbar
        onSampleData={sendSampleData}
        isStressLoaded={stressLoaded}
        onStressClick={handleStressClick}
        stressBusy={stressBusy}
        perfOpen={perfOpen}
        onTogglePerformance={() => setPerfOpen(p => !p)}
        onToggleShortcuts={() => setShortcutsOpen(prev => !prev)}
      />
      {!hintDismissed && (
        <HintBar onDismiss={() => setHintDismissed(true)} />
      )}
      <FormulaBar
        cellId={cellId}
        cellEditing={nav.mode === 'edit'}
        cellEditBuffer={editBuffer}
        onRefocusGrid={handleRefocusGrid}
      />
      <Grid
        ref={gridRef}
        onNavChange={handleNavChange}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      {perfOpen && (
        <PerformanceStrip
          stats={meta.stats}
          meta={meta}
          evalMode={meta.evalMode}
          onModeChange={setEvalMode}
        />
      )}
      <StatusBar
        usersCount={meta.users.length}
        version={meta.version}
        stats={meta.stats}
        perfOpen={perfOpen}
        onTogglePerformance={() => setPerfOpen(p => !p)}
      />
      {shortcutsOpen && (
        <ShortcutsPopover
          popoverRef={popoverRef}
          onClose={() => {
            setShortcutsOpen(false);
            gridRef.current?.refocus();
          }}
        />
      )}
      <ToastContainer toasts={meta.toasts} />
    </div>
  );
}

// ── Top bar with editable title, connection text, avatars, share ──

function TopBar({
  title,
  onTitleChange,
  connection,
  users,
  accountMenu,
}: {
  title: string;
  onTitleChange: (t: string) => void;
  connection: 'connected' | 'reconnecting';
  users: User[];
  accountMenu?: React.ReactNode;
}) {
  const myU = getMyU();

  const handleShare = () => {
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(window.location.href);
      } else {
        const ta = document.createElement('textarea');
        ta.value = window.location.href;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      // fallback
    }
    addToast('Link copied');
  };

  const connectionText = connection === 'connected' ? 'Connected' : 'Reconnecting...';

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
        gap: 'var(--space-3)',
      }}
    >
      <input
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        aria-label="Sheet title"
        style={{
          fontWeight: 600,
          fontSize: '14px',
          color: 'var(--text)',
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 'var(--radius)',
          padding: '2px 6px',
          outline: 'none',
          fontFamily: 'var(--font-ui)',
          minWidth: 120,
          maxWidth: 240,
        }}
        onFocus={(e) => {
          e.target.style.borderColor = 'var(--accent)';
        }}
        onBlur={(e) => {
          e.target.style.borderColor = 'transparent';
        }}
      />
      <div
        style={{
          fontSize: '12px',
          color: 'var(--muted)',
          userSelect: 'none',
        }}
      >
        {connectionText}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {users.filter(u => u.u !== myU).map(u => (
          <Avatar key={u.u} user={u} />
        ))}
      </div>
      <button
        type="button"
        onClick={handleShare}
        className="btn-bordered"
      >
        Share
      </button>
      {accountMenu}
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

// ── Toolbar ──

function Toolbar({
  onSampleData,
  isStressLoaded,
  onStressClick,
  stressBusy,
  perfOpen,
  onTogglePerformance,
  onToggleShortcuts,
}: {
  onSampleData: () => void;
  isStressLoaded: boolean;
  onStressClick: () => void;
  stressBusy: boolean;
  perfOpen: boolean;
  onTogglePerformance: () => void;
  onToggleShortcuts: () => void;
}) {
  return (
    <div
      style={{
        height: 36,
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-4)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        flexShrink: 0,
        gap: 'var(--space-2)',
      }}
    >
      <button
        type="button"
        id="btn-sample-data"
        className="btn-text"
        onClick={onSampleData}
      >
        Sample data
      </button>
      <button
        type="button"
        id="btn-stress-test"
        className="btn-text"
        onClick={onStressClick}
        disabled={stressBusy}
        style={isStressLoaded ? { color: 'var(--accent)' } : undefined}
      >
        {isStressLoaded ? 'Clear stress data' : 'Stress test'}
      </button>
      <button
        type="button"
        id="btn-performance"
        className="btn-text"
        onClick={onTogglePerformance}
        style={perfOpen ? { background: 'var(--accent-weak)', color: 'var(--accent)', fontWeight: 600 } : undefined}
      >
        Performance
      </button>
      <button
        type="button"
        id="btn-shortcuts"
        className="btn-text"
        onClick={onToggleShortcuts}
      >
        Shortcuts
      </button>
    </div>
  );
}

// ── Dismissible Hint Bar ──

function HintBar({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '6px var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '12px',
        color: 'var(--text)',
        flexShrink: 0,
      }}
    >
      <span>Type = to start a formula. Open this page in another window to collaborate.</span>
      <button
        type="button"
        className="btn-text"
        onClick={onDismiss}
        style={{ fontSize: '12px', padding: '2px 8px' }}
      >
        Dismiss
      </button>
    </div>
  );
}

// ── Status Bar ──

function StatusBar({
  usersCount,
  version,
  stats,
  perfOpen,
  onTogglePerformance,
}: {
  usersCount: number;
  version: number;
  stats: Stats | null;
  perfOpen: boolean;
  onTogglePerformance: () => void;
}) {
  const recalcText = stats
    ? `${stats.scope} of ${stats.populated.toLocaleString()} cells, ${stats.ms.toFixed(1)} ms`
    : '0 of 0 cells, 0.0 ms';

  return (
    <div
      style={{
        height: 28,
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-4)',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        fontSize: '12px',
        color: 'var(--muted)',
        flexShrink: 0,
        gap: 'var(--space-4)',
        userSelect: 'none',
      }}
    >
      <div>{usersCount} {usersCount === 1 ? 'user' : 'users'} online</div>
      <div>v{version}</div>
      <div>{recalcText}</div>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        id="btn-status-performance"
        className="btn-text"
        onClick={onTogglePerformance}
        style={{
          fontSize: '12px',
          padding: '0 6px',
          color: perfOpen ? 'var(--accent)' : 'var(--muted)',
          fontWeight: perfOpen ? 600 : 400,
        }}
      >
        Performance
      </button>
    </div>
  );
}

// ── Shortcuts Popover ──

function ShortcutsPopover({
  popoverRef,
  onClose,
}: {
  popoverRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
}) {
  const shortcuts: Array<[string, string]> = [
    ['Arrow keys', 'Navigate cells'],
    ['Enter', 'Commit and move down'],
    ['Shift + Enter', 'Commit and move up'],
    ['Tab', 'Commit and move right'],
    ['Shift + Tab', 'Commit and move left'],
    ['F2', 'Edit active cell'],
    ['Delete / Backspace', 'Clear cell content'],
    ['Escape', 'Cancel editing / close popover'],
    ['Ctrl + C', 'Copy cell raw value'],
    ['Ctrl + V', 'Paste TSV data'],
    ['?', 'Open shortcuts'],
  ];

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: 84,
        left: 'var(--space-4)',
        zIndex: 1000,
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-pop)',
        padding: 'var(--space-3) var(--space-4)',
        width: 320,
        fontSize: '12px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-2)',
          paddingBottom: 'var(--space-1)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
          Keyboard shortcuts
        </div>
        <button
          type="button"
          className="btn-text"
          onClick={onClose}
          style={{ fontSize: '12px', padding: '2px 6px' }}
        >
          Close
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {shortcuts.map(([key, desc]) => (
          <div
            key={key}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              lineHeight: '20px',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--text)',
                background: 'var(--surface)',
                padding: '1px 4px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
              }}
            >
              {key}
            </span>
            <span style={{ color: 'var(--muted)' }}>{desc}</span>
          </div>
        ))}
      </div>
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
