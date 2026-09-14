import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { initMonitoring } from './shared/monitoring';
import './index.css';

// Reporte de errores del frontend (no-op si no hay VITE_SENTRY_DSN).
initMonitoring();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => {
      registrations
        .forEach((registration) => registration.unregister().catch(() => {}));
    })
    .catch(() => {});
}

if ('caches' in window) {
  caches.keys()
    .then((keys) => Promise.all(
      keys
        .filter((key) => /workbox|precache|vite|meraki/i.test(key))
        .map((key) => caches.delete(key))
    ))
    .catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
