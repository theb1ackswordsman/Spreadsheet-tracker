import React, { useCallback, useRef, useState, useEffect } from 'react';
import { COLS, ROWS } from '../engine/constants';
import { Cell, getDevRenderCount, resetDevRenderCount } from './Cell';
import { reduce, initNav, toCellId, colLabel } from './nav';
import type { NavState, NavAction } from './nav';
import { subscribeMeta } from './store';

// ── Constants ──

const ROW_H = 28;
const COL_W = 104;
const HEADER_COL_W = 48;
const OVERSCAN = 4;

const TOTAL_HEIGHT = ROWS * ROW_H;
const TOTAL_WIDTH = COLS * COL_W;

// ── Expose render counter via store meta (dev only) ──

if (import.meta.env.DEV) {
  subscribeMeta(() => {
    // meta subscriber so dev tools can inspect
  });
  // Expose to window for console access
  const w = window as unknown as Record<string, unknown>;
  w['__gridDevRenderCount'] = getDevRenderCount;
  w['__gridDevRenderReset'] = resetDevRenderCount;
}

// ── Grid component ──

export function Grid() {
  const [nav, setNav] = useState<NavState>(initNav);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const rafRef = useRef(0);
  const [visibleStart, setVisibleStart] = useState(0);
  const [visibleEnd, setVisibleEnd] = useState(30);

  // Compute visible rows from scroll position
  const updateVisibleRows = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const viewH = el.clientHeight;
    const firstVisible = Math.floor(scrollTop / ROW_H);
    const lastVisible = Math.ceil((scrollTop + viewH) / ROW_H);
    const start = Math.max(0, firstVisible - OVERSCAN);
    const end = Math.min(ROWS, lastVisible + OVERSCAN);
    setVisibleStart(start);
    setVisibleEnd(end);
  }, []);

  // rAF-throttled scroll handler
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    scrollTopRef.current = el.scrollTop;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      updateVisibleRows();
    });
  }, [updateVisibleRows]);

  // Initial size computation
  useEffect(() => {
    updateVisibleRows();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [updateVisibleRows]);

  // Dispatch nav action
  const dispatch = useCallback((action: NavAction) => {
    setNav(prev => reduce(prev, action));
  }, []);

  // Click handler for cells
  const handleCellClick = useCallback((col: number, row: number) => {
    dispatch({ t: 'CLICK', col, row });
  }, [dispatch]);

  // Keyboard handler on the grid container
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Only handle keys in navigate mode
    // We read the latest nav via the functional setState trick
    setNav(prev => {
      if (prev.mode !== 'navigate') return prev;

      let action: NavAction | null = null;

      switch (e.key) {
        case 'ArrowUp':    action = { t: 'ARROW', dc: 0, dr: -1 }; break;
        case 'ArrowDown':  action = { t: 'ARROW', dc: 0, dr: 1 }; break;
        case 'ArrowLeft':  action = { t: 'ARROW', dc: -1, dr: 0 }; break;
        case 'ArrowRight': action = { t: 'ARROW', dc: 1, dr: 0 }; break;
        case 'Tab':        action = { t: 'TAB', shift: e.shiftKey }; break;
        case 'Enter':      action = { t: 'ENTER', shift: e.shiftKey }; break;
        default: return prev;
      }

      e.preventDefault();
      return reduce(prev, action);
    });
  }, []);

  // Scroll active cell into view
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cellTop = nav.row * ROW_H;
    const cellBottom = cellTop + ROW_H;
    const viewTop = el.scrollTop;
    const headerH = ROW_H; // sticky header row
    const viewBottom = viewTop + el.clientHeight;

    if (cellTop < viewTop + headerH) {
      el.scrollTop = cellTop - headerH;
    } else if (cellBottom > viewBottom) {
      el.scrollTop = cellBottom - el.clientHeight;
    }

    // Horizontal scroll for active cell
    const cellLeft = nav.col * COL_W;
    const cellRight = cellLeft + COL_W;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth;

    if (cellLeft < viewLeft + HEADER_COL_W) {
      el.scrollLeft = cellLeft - HEADER_COL_W;
    } else if (cellRight > viewRight) {
      el.scrollLeft = cellRight - el.clientWidth;
    }
  }, [nav.col, nav.row]);

  // Build visible rows
  const rows: React.ReactNode[] = [];
  for (let r = visibleStart; r < visibleEnd; r++) {
    const isActiveRow = r === nav.row;
    const cells: React.ReactNode[] = [];
    for (let c = 0; c < COLS; c++) {
      const id = toCellId(c, r);
      const isActive = c === nav.col && r === nav.row;
      cells.push(
        <Cell
          key={id}
          id={id}
          col={c}
          row={r}
          active={isActive}
          onClick={handleCellClick}
        />
      );
    }

    // Row header
    const rowHeaderStyle: React.CSSProperties = {
      position: 'sticky',
      left: 0,
      width: HEADER_COL_W,
      height: ROW_H,
      lineHeight: `${ROW_H}px`,
      textAlign: 'center',
      background: 'var(--header)',
      borderRight: '1px solid var(--border)',
      borderBottom: '1px solid var(--grid-line)',
      fontSize: '12px',
      color: isActiveRow ? 'var(--accent)' : 'var(--muted)',
      fontWeight: isActiveRow ? 700 : 400,
      backgroundColor: isActiveRow ? 'var(--accent-weak)' : 'var(--header)',
      zIndex: 2,
      boxSizing: 'border-box',
      userSelect: 'none',
      flexShrink: 0,
    };

    rows.push(
      <div
        key={r}
        role="row"
        aria-rowindex={r + 2}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: HEADER_COL_W + TOTAL_WIDTH,
          height: ROW_H,
          transform: `translateY(${r * ROW_H}px)`,
          display: 'flex',
        }}
      >
        <div style={rowHeaderStyle}>{r + 1}</div>
        <div style={{ position: 'relative', width: TOTAL_WIDTH, height: ROW_H }}>
          {cells}
        </div>
      </div>
    );
  }

  // Column headers
  const colHeaders: React.ReactNode[] = [];
  for (let c = 0; c < COLS; c++) {
    const isActiveCol = c === nav.col;
    colHeaders.push(
      <div
        key={c}
        style={{
          width: COL_W,
          height: ROW_H,
          lineHeight: `${ROW_H}px`,
          textAlign: 'center',
          borderRight: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          fontSize: '12px',
          color: isActiveCol ? 'var(--accent)' : 'var(--muted)',
          fontWeight: isActiveCol ? 700 : 400,
          backgroundColor: isActiveCol ? 'var(--accent-weak)' : 'var(--header)',
          boxSizing: 'border-box',
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        {colLabel(c)}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="grid"
      tabIndex={0}
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 8px)',
        overflow: 'auto',
        outline: 'none',
        fontFamily: 'var(--font-ui)',
        fontSize: '13px',
        background: 'var(--bg)',
      }}
    >
      {/* Sticky column header row */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 3,
          display: 'flex',
          width: HEADER_COL_W + TOTAL_WIDTH,
          height: ROW_H,
          background: 'var(--header)',
        }}
      >
        {/* Corner cell */}
        <div
          style={{
            position: 'sticky',
            left: 0,
            width: HEADER_COL_W,
            height: ROW_H,
            background: 'var(--header)',
            borderRight: '1px solid var(--border)',
            borderBottom: '1px solid var(--border)',
            zIndex: 4,
            boxSizing: 'border-box',
            flexShrink: 0,
          }}
        />
        {colHeaders}
      </div>

      {/* Spacer for total scrollable height */}
      <div
        style={{
          position: 'relative',
          width: HEADER_COL_W + TOTAL_WIDTH,
          height: TOTAL_HEIGHT,
        }}
      >
        {rows}
      </div>
    </div>
  );
}
