import React, { useCallback, useRef, useState, useEffect, useImperativeHandle } from 'react';
import { COLS, ROWS } from '../engine/constants';
import { Cell, getDevRenderCount, resetDevRenderCount } from './Cell';
import { Editor } from './Editor';
import { reduce, initNav, toCellId, colLabel } from './nav';
import type { NavState, NavAction } from './nav';
import { subscribeMeta, getRaw } from './store';
import { commitEdits } from './commit';

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

// ── Helpers ──

function isPrintable(key: string): boolean {
  return key.length === 1 && !key.match(/[\x00-\x1f]/);
}

// ── Grid component ──

export interface GridHandle {
  refocus: () => void;
}

export interface GridProps {
  onNavChange?: (nav: NavState, editBuffer: string) => void;
}

export const Grid = React.forwardRef<GridHandle, GridProps>(function Grid(
  { onNavChange },
  ref
) {
  const [nav, setNav] = useState<NavState>(initNav);
  const [editBuffer, setEditBuffer] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const rafRef = useRef(0);
  const [visibleStart, setVisibleStart] = useState(0);
  const [visibleEnd, setVisibleEnd] = useState(30);
  // Track the raw value at edit start for cancel/restore
  const editStartRawRef = useRef('');

  // Notify parent of nav/edit changes
  const navRef = useRef(nav);
  const editBufferRef = useRef(editBuffer);
  navRef.current = nav;
  editBufferRef.current = editBuffer;

  useEffect(() => {
    onNavChange?.(nav, editBuffer);
  }, [nav, editBuffer, onNavChange]);

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

  // Refocus grid container
  const refocusGrid = useCallback(() => {
    containerRef.current?.focus();
  }, []);

  useImperativeHandle(ref, () => ({
    refocus: refocusGrid,
  }), [refocusGrid]);

  // Start editing with a given initial value
  const startEdit = useCallback((initialValue: string) => {
    const cellId = toCellId(navRef.current.col, navRef.current.row);
    editStartRawRef.current = getRaw(cellId);
    setEditBuffer(initialValue);
    setNav(prev => reduce(prev, { t: 'EDIT_START' }));
  }, []);

  // Commit the current edit buffer
  const doCommit = useCallback((value: string) => {
    const n = navRef.current;
    if (n.mode !== 'edit') return;
    const cellId = toCellId(n.col, n.row);
    commitEdits([{ cell: cellId, raw: value }]);
    setNav(prev => reduce(prev, { t: 'COMMIT' }));
    refocusGrid();
  }, [refocusGrid]);

  // Commit and move (Enter/Tab from editor)
  const doCommitAndMove = useCallback((value: string, direction: 'down' | 'up' | 'right' | 'left') => {
    const n = navRef.current;
    const cellId = toCellId(n.col, n.row);
    commitEdits([{ cell: cellId, raw: value }]);
    if (direction === 'down' || direction === 'up') {
      setNav(prev => reduce(prev, { t: 'ENTER', shift: direction === 'up' }));
    } else {
      setNav(prev => reduce(prev, { t: 'TAB', shift: direction === 'left' }));
    }
    refocusGrid();
  }, [refocusGrid]);

  // Cancel editing, restore original value
  const doCancel = useCallback(() => {
    setNav(prev => reduce(prev, { t: 'CANCEL' }));
    refocusGrid();
  }, [refocusGrid]);

  // Handle buffer changes from formula bar
  const handleBufferChange = useCallback((value: string) => {
    setEditBuffer(value);
  }, []);

  // Handle formula bar starting edit
  const handleFormulaBarStartEdit = useCallback((value: string) => {
    startEdit(value);
  }, [startEdit]);

  // Click handler for cells
  const handleCellClick = useCallback((col: number, row: number) => {
    // If editing a different cell, commit first
    setNav(prev => {
      if (prev.mode === 'edit') {
        const cellId = toCellId(prev.col, prev.row);
        commitEdits([{ cell: cellId, raw: editBufferRef.current }]);
      }
      return reduce(prev, { t: 'CLICK', col, row });
    });
  }, []);

  // Double-click handler for cells
  const handleCellDoubleClick = useCallback((col: number, row: number) => {
    const prev = navRef.current;
    if (prev.mode === 'edit') {
      const prevCellId = toCellId(prev.col, prev.row);
      commitEdits([{ cell: prevCellId, raw: editBufferRef.current }]);
    }
    const cellId = toCellId(col, row);
    const raw = getRaw(cellId);
    editStartRawRef.current = raw;
    setEditBuffer(raw);
    setNav({ col, row, mode: 'edit' });
  }, []);

  // Keyboard handler on the grid container
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    setNav(prev => {
      if (prev.mode === 'edit') {
        // In edit mode, the Editor/FormulaBar handles its own keys
        return prev;
      }

      // Navigate mode
      let action: NavAction | null = null;

      switch (e.key) {
        case 'ArrowUp':    action = { t: 'ARROW', dc: 0, dr: -1 }; break;
        case 'ArrowDown':  action = { t: 'ARROW', dc: 0, dr: 1 }; break;
        case 'ArrowLeft':  action = { t: 'ARROW', dc: -1, dr: 0 }; break;
        case 'ArrowRight': action = { t: 'ARROW', dc: 1, dr: 0 }; break;
        case 'Tab':
          e.preventDefault();
          return reduce(prev, { t: 'TAB', shift: e.shiftKey });
        case 'Enter':
          if (e.shiftKey) {
            e.preventDefault();
            return reduce(prev, { t: 'ENTER', shift: true });
          }
          // Enter without shift does NOT move in navigate mode; starts editing would be another option
          // but per P2b, Enter moves. Actually, re-reading: the existing nav behavior has Enter moving.
          // But now with editing, we should keep Enter moving in navigate mode.
          e.preventDefault();
          return reduce(prev, { t: 'ENTER', shift: false });
        case 'F2': {
          e.preventDefault();
          const cellId = toCellId(prev.col, prev.row);
          const raw = getRaw(cellId);
          editStartRawRef.current = raw;
          setEditBuffer(raw);
          return reduce(prev, { t: 'EDIT_START' });
        }
        case 'Delete':
        case 'Backspace': {
          e.preventDefault();
          const cellId = toCellId(prev.col, prev.row);
          commitEdits([{ cell: cellId, raw: '' }]);
          return prev;
        }
        default: {
          // Printable character: start editing with that character
          if (isPrintable(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            const cellId = toCellId(prev.col, prev.row);
            editStartRawRef.current = getRaw(cellId);
            setEditBuffer(e.key);
            return reduce(prev, { t: 'EDIT_START' });
          }
          return prev;
        }
      }

      if (action) {
        e.preventDefault();
        return reduce(prev, action);
      }
      return prev;
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
      const isEditing = isActive && nav.mode === 'edit';

      if (isEditing) {
        cells.push(
          <Editor
            key={`editor-${id}`}
            col={c}
            row={r}
            initialValue={editBuffer}
            onChange={setEditBuffer}
            onCommit={doCommit}
            onCancel={doCancel}
            onCommitAndMove={doCommitAndMove}
          />
        );
      } else {
        cells.push(
          <Cell
            key={id}
            id={id}
            col={c}
            row={r}
            active={isActive}
            onClick={handleCellClick}
            onDoubleClick={handleCellDoubleClick}
          />
        );
      }
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
        flex: 1,
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
});

// Export for App.tsx to wire FormulaBar
export type { NavState };
