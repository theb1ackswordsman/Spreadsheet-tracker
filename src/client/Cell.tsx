import React from 'react';
import {
  useCell, usePresence, bumpRenderCount,
  getRenderCount, resetRenderCount,
  getDevRenderCount, resetDevRenderCount,
} from './store';
import { getMyU } from './socket';
import type { CellId } from '../engine/types';
import type { User } from '../shared/protocol';

// Re-export for Grid to use
export { getRenderCount, resetRenderCount, getDevRenderCount, resetDevRenderCount };

// ── Cell component ──

const COL_W = 104;
const ROW_H = 28;

interface CellProps {
  id: CellId;
  col: number;
  row: number;
  active: boolean;
  onClick: (col: number, row: number) => void;
  onDoubleClick: (col: number, row: number) => void;
}

export const Cell = React.memo(function Cell({ id, col, row, active, onClick, onDoubleClick }: CellProps) {
  bumpRenderCount();

  const result = useCell(id);
  const presence = usePresence(id);

  const handleClick = () => {
    onClick(col, row);
  };

  const handleDoubleClick = () => {
    onDoubleClick(col, row);
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

  // Filter out self from presence
  const myU = getMyU();
  const remotePresence = myU ? presence.filter(u => u.u !== myU) : presence;

  // Determine remote selection border color (first remote user's color)
  const remoteBorderColor = remotePresence.length > 0 ? remotePresence[0]!.color : null;

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
  } else if (remoteBorderColor) {
    style.outline = `2px solid ${remoteBorderColor}`;
    style.outlineOffset = '-2px';
    style.zIndex = 1;
  }

  return (
    <div
      role="gridcell"
      aria-colindex={col + 2}
      style={style}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {content}
      {remotePresence.length > 0 && (
        <PresenceTags users={remotePresence} />
      )}
    </div>
  );
});

// ── Presence name tags ──

function PresenceTags({ users }: { users: User[] }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: -15,
        left: -2,
        display: 'flex',
        gap: '1px',
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      {users.map(u => (
        <div
          key={u.u}
          style={{
            fontSize: '11px',
            lineHeight: '13px',
            padding: '0 3px',
            background: u.color,
            color: 'var(--bg)',
            borderRadius: '2px',
            whiteSpace: 'nowrap',
          }}
        >
          {u.name}
        </div>
      ))}
    </div>
  );
}
