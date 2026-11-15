import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

// Client-to-server debug log forwarder
if (typeof window !== 'undefined') {
  const sendLog = (type: string, ...args: unknown[]) => {
    try {
      const text = args
        .map((a) => {
          if (a instanceof Error) return a.stack || a.message;
          if (typeof a === 'object') {
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          }
          return String(a);
        })
        .join(' ');
      navigator.sendBeacon?.('/__client_log', JSON.stringify({ type, text }));
    } catch {
      // Ignore beacon failures
    }
  };

  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...args) => {
    origError(...args);
    sendLog('error', ...args);
  };
  console.warn = (...args) => {
    origWarn(...args);
    sendLog('warn', ...args);
  };
  window.addEventListener('error', (e) => {
    sendLog('uncaught', e.message, e.filename, `${e.lineno}:${e.colno}`, e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    sendLog('unhandledrejection', e.reason?.stack ?? e.reason);
  });
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
