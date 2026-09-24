import React, { useRef, useEffect, useState } from 'react';

const COL_W = 104;
const ROW_H = 28;

interface EditorProps {
  col: number;
  row: number;
  initialValue: string;
  onChange?: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
  onCommitAndMove: (value: string, direction: 'down' | 'up' | 'right' | 'left') => void;
}

export function Editor({ col, row, initialValue, onChange, onCommit, onCancel, onCommitAndMove }: EditorProps) {
  const [buffer, setBuffer] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const isFinishedRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      // Place cursor at end
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (isFinishedRef.current) return;
        isFinishedRef.current = true;
        onCommitAndMove(buffer, e.shiftKey ? 'up' : 'down');
        break;
      case 'Tab':
        e.preventDefault();
        e.stopPropagation();
        if (isFinishedRef.current) return;
        isFinishedRef.current = true;
        onCommitAndMove(buffer, e.shiftKey ? 'left' : 'right');
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (isFinishedRef.current) return;
        isFinishedRef.current = true;
        onCancel();
        break;
    }
  };

  const handleBlur = () => {
    if (isFinishedRef.current) return;
    isFinishedRef.current = true;
    onCommit(buffer);
  };

  const style: React.CSSProperties = {
    position: 'absolute',
    left: col * COL_W,
    top: 0,
    width: COL_W,
    height: ROW_H,
    boxSizing: 'border-box',
    padding: '0 8px',
    lineHeight: `${ROW_H}px`,
    border: 'none',
    outline: '2px solid var(--accent)',
    outlineOffset: '-2px',
    zIndex: 5,
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: 'var(--text)',
    background: 'var(--bg)',
    margin: 0,
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={buffer}
      onChange={(e) => {
        setBuffer(e.target.value);
        onChange?.(e.target.value);
      }}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      style={style}
      role="gridcell"
      aria-colindex={col + 2}
    />
  );
}
