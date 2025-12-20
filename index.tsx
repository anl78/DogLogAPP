import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Polyfill para process.env en el navegador para evitar errores de referencia con la API de Gemini
// Added 'as any' cast to window to prevent TypeScript error about missing 'process' property
if (typeof window !== 'undefined' && !(window as any).process) {
  (window as any).process = { env: {} };
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);