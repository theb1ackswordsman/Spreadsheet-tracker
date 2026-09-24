import React from 'react';
import ReactDOM from 'react-dom/client';
import { Root } from './Root';
import './bridge'; // module-level singleton: creates worker
import './styles/tokens.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  );
}
