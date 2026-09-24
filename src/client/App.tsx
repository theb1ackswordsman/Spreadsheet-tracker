import React, { useState, useCallback, useRef } from 'react';
import { Grid, type GridHandle } from './Grid';
import { FormulaBar } from './FormulaBar';
import { toCellId, type NavState } from './nav';

export function App() {
  const [nav, setNav] = useState<NavState>({ col: 0, row: 0, mode: 'navigate' });
  const [editBuffer, setEditBuffer] = useState('');
  const gridRef = useRef<GridHandle>(null);

  const handleNavChange = useCallback((n: NavState, buf: string) => {
    setNav(n);
    setEditBuffer(buf);
  }, []);

  const handleRefocusGrid = useCallback(() => {
    gridRef.current?.refocus();
  }, []);

  const cellId = toCellId(nav.col, nav.row);

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
      <FormulaBar
        cellId={cellId}
        cellEditing={nav.mode === 'edit'}
        cellEditBuffer={editBuffer}
        onRefocusGrid={handleRefocusGrid}
      />
      <Grid ref={gridRef} onNavChange={handleNavChange} />
    </div>
  );
}
