import React from 'react';
import { Grid } from './Grid';

export function App() {
  return (
    <div
      style={{
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-ui)',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <Grid />
    </div>
  );
}
