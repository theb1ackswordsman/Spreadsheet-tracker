import React from 'react';
import type { Stats, Mode } from '../engine/types';
import type { StoreMeta } from './store';

interface PerformanceStripProps {
  stats: Stats | null;
  meta: StoreMeta;
  evalMode: Mode;
  onModeChange: (mode: Mode) => void;
}

export function PerformanceStrip({
  stats,
  meta,
  evalMode,
  onModeChange,
}: PerformanceStripProps) {
  const scope = stats ? stats.scope : 0;
  const populated = stats ? stats.populated : 0;
  const ms = stats ? stats.ms.toFixed(1) : '0.0';
  const mode = stats ? stats.mode : evalMode;
  const renderCount = meta.renderCount;
  const version = meta.version;
  const rttText = meta.rtt !== null ? `${meta.rtt.toFixed(1)} ms` : '—';

  return (
    <div
      id="performance-strip"
      role="region"
      aria-label="Performance details"
      style={{
        height: 32,
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-4)',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        fontSize: '12px',
        color: 'var(--text)',
        flexShrink: 0,
        gap: 'var(--space-4)',
        fontVariantNumeric: 'tabular-nums',
        userSelect: 'none',
      }}
    >
      <div>
        <span style={{ color: 'var(--muted)' }}>Scope: </span>
        <span style={{ fontWeight: 500 }}>{scope}</span>
      </div>
      <div>
        <span style={{ color: 'var(--muted)' }}>Populated: </span>
        <span style={{ fontWeight: 500 }}>{populated.toLocaleString()}</span>
      </div>
      <div>
        <span style={{ color: 'var(--muted)' }}>Recalc: </span>
        <span style={{ fontWeight: 500 }}>{ms} ms</span>
      </div>
      <div>
        <span style={{ color: 'var(--muted)' }}>Mode: </span>
        <span style={{ fontWeight: 500 }}>{mode}</span>
      </div>
      <div>
        <span style={{ color: 'var(--muted)' }}>Rendered: </span>
        <span style={{ fontWeight: 500 }}>{renderCount}</span>
      </div>
      <div>
        <span style={{ color: 'var(--muted)' }}>Version: </span>
        <span style={{ fontWeight: 500 }}>v{version}</span>
      </div>
      <div>
        <span style={{ color: 'var(--muted)' }}>RTT: </span>
        <span style={{ fontWeight: 500 }}>{rttText}</span>
      </div>

      <div style={{ flex: 1 }} />

      {/* Incremental | Naive segmented control */}
      <div
        role="group"
        aria-label="Evaluation mode"
        style={{
          display: 'inline-flex',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
          background: 'var(--bg)',
        }}
      >
        <button
          type="button"
          id="btn-mode-inc"
          onClick={() => onModeChange('inc')}
          style={{
            padding: '2px 8px',
            fontSize: '11px',
            fontFamily: 'var(--font-ui)',
            cursor: 'pointer',
            border: 'none',
            outline: 'none',
            background: evalMode === 'inc' ? 'var(--accent-weak)' : 'transparent',
            color: evalMode === 'inc' ? 'var(--accent)' : 'var(--muted)',
            fontWeight: evalMode === 'inc' ? 600 : 400,
          }}
        >
          Incremental
        </button>
        <button
          type="button"
          id="btn-mode-naive"
          onClick={() => onModeChange('naive')}
          style={{
            padding: '2px 8px',
            fontSize: '11px',
            fontFamily: 'var(--font-ui)',
            cursor: 'pointer',
            border: 'none',
            borderLeft: '1px solid var(--border)',
            outline: 'none',
            background: evalMode === 'naive' ? 'var(--accent-weak)' : 'transparent',
            color: evalMode === 'naive' ? 'var(--accent)' : 'var(--muted)',
            fontWeight: evalMode === 'naive' ? 600 : 400,
          }}
        >
          Naive
        </button>
      </div>
    </div>
  );
}
