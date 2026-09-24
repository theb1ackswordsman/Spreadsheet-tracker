import React, { useRef, useState, useEffect } from 'react';
import type { CellId, ErrCode } from '../engine/types';
import { useCell, useRaw } from './store';
import { commitEdits } from './commit';

// ── Error explanations (from DESIGN "Components") ──

const ERROR_EXPLANATIONS: Record<ErrCode, string> = {
  '#CIRCULAR!': 'Circular reference: this cell depends on itself',
  '#DIV/0!': 'Division by zero',
  '#NAME?': 'Unknown function',
  '#REF!': 'Reference outside the sheet',
  '#VALUE!': 'Value error: check the formula',
};

interface FormulaBarProps {
  cellId: CellId;
  cellEditing?: boolean;
  cellEditBuffer?: string;
  onRefocusGrid?: () => void;
}

export function FormulaBar({
  cellId,
  cellEditing = false,
  cellEditBuffer = '',
  onRefocusGrid,
}: FormulaBarProps) {
  const result = useCell(cellId);
  const raw = useRaw(cellId);

  const [isFocused, setIsFocused] = useState(false);
  const [localBuffer, setLocalBuffer] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isFinishedRef = useRef(false);

  // Sync local buffer when cellId or raw changes and not focused
  useEffect(() => {
    if (!isFocused) {
      setLocalBuffer(raw);
    }
  }, [cellId, raw, isFocused]);

  // Determine what to display:
  // 1. If formula bar is focused, show local typing buffer
  // 2. If cell in grid is actively editing, show grid's edit buffer
  // 3. Otherwise show store raw
  let displayValue: string;
  if (isFocused) {
    displayValue = localBuffer;
  } else if (cellEditing) {
    displayValue = cellEditBuffer;
  } else {
    displayValue = raw;
  }

  const handleFocus = () => {
    setIsFocused(true);
    setLocalBuffer(raw);
    isFinishedRef.current = false;
  };

  const handleBlur = () => {
    if (isFinishedRef.current) return;
    isFinishedRef.current = true;
    setIsFocused(false);
    commitEdits([{ cell: cellId, raw: localBuffer }]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isFinishedRef.current) return;
      isFinishedRef.current = true;
      setIsFocused(false);
      commitEdits([{ cell: cellId, raw: localBuffer }]);
      onRefocusGrid?.();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (isFinishedRef.current) return;
      isFinishedRef.current = true;
      setIsFocused(false);
      setLocalBuffer(raw);
      onRefocusGrid?.();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (isFinishedRef.current) return;
      isFinishedRef.current = true;
      setIsFocused(false);
      commitEdits([{ cell: cellId, raw: localBuffer }]);
      onRefocusGrid?.();
    }
  };

  const errorText = result.e !== null ? ERROR_EXPLANATIONS[result.e] : '';

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 32,
        }}
      >
        {/* Name box */}
        <div
          style={{
            width: 64,
            height: 32,
            lineHeight: '32px',
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--text)',
            borderRight: '1px solid var(--border)',
            flexShrink: 0,
            userSelect: 'none',
          }}
        >
          {cellId}
        </div>

        {/* fx label */}
        <div
          style={{
            width: 32,
            height: 32,
            lineHeight: '32px',
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            color: 'var(--muted)',
            flexShrink: 0,
            userSelect: 'none',
          }}
        >
          fx
        </div>

        {/* Monospace formula input */}
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={(e) => setLocalBuffer(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1,
            height: 32,
            border: 'none',
            outline: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            color: 'var(--text)',
            background: 'transparent',
            padding: '0 var(--space-2)',
            boxSizing: 'border-box',
            lineHeight: '32px',
          }}
        />
      </div>

      {/* Error explanation line */}
      <div
        style={{
          height: 20,
          lineHeight: '20px',
          fontSize: '12px',
          color: 'var(--danger)',
          paddingLeft: 'calc(64px + 32px + var(--space-2))',
          paddingRight: 'var(--space-2)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {errorText}
      </div>
    </div>
  );
}
