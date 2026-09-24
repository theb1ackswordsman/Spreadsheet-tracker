import React from 'react';
import { useCell, bumpRenderCount, getDevRenderCount, resetDevRenderCount } from './store';
import type { CellId } from '../engine/types';

// Re-export for Grid to use
export { getDevRenderCount, resetDevRenderCount };

// ── Cell component ──

const COL_W = 104;
const ROW_H = 28;

interface CellProps {
  id: CellId;
  col: number;
  row: number;
  active: boolean;
  onClick: (col: number, row: number) => void;
}

export const Cell = React.memo(function Cell({ id, col, row, active, onClick }: CellProps) {
  if (import.meta.env.DEV) {
    bumpRenderCount();
  }

  const result = useCell(id);

  const handleClick = () => {
    onClick(col, row);
  };

  let content: string;
  let textAlign: 'left' | 'right' | 'center';
  let color: string | undefined;

  if (result.e !== null) {
    content = result.e;
    textAlign = 'center';
    color = 'var(--danger)';
  } else if (result.v === null) {
    content = '';
    textAlign = 'left';
  } else if (typeof result.v === 'number') {
    content = String(Number(result.v.toPrecision(12)));
    textAlign = 'right';
  } else {
    content = result.v;
    textAlign = 'left';
  }

  const style: React.CSSProperties = {
    position: 'absolute',
    left: col * COL_W,
    top: 0,
    width: COL_W,
    height: ROW_H,
    boxSizing: 'border-box',
    padding: '0 8px',
    lineHeight: `${ROW_H}px`,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    borderRight: '1px solid var(--grid-line)',
    borderBottom: '1px solid var(--grid-line)',
    fontVariantNumeric: typeof result.v === 'number' ? 'tabular-nums' : undefined,
    textAlign,
    color,
    cursor: 'cell',
  };

  if (active) {
    style.outline = '2px solid var(--accent)';
    style.outlineOffset = '-2px';
    style.zIndex = 1;
  }

  return (
    <div
      role="gridcell"
      aria-colindex={col + 2}
      style={style}
      onClick={handleClick}
    >
      {content}
    </div>
  );
});
