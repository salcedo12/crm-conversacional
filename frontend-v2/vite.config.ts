import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg'],
      manifest: {
        name:             'Meraki CRM',
        short_name:       'Meraki CRM',
        description:      'CRM conversacional: WhatsApp, leads y agenda',
        theme_color:      '#7c3aed',
        background_color: '#09090b',
        display:          'standalone',
        orientation:      'portrait',
        start_url:        '/dashboard/inbox',
        icons: [
          { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // No cachear las llamadas a Firebase (deben ir siempre a la red)
        navigateFallbackDenylist: [/^\/__/, /firebaseio|googleapis|cloudfunctions/],
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Separar librerías grandes en chunks propios: cambian poco, así el
        // navegador las cachea entre despliegues y solo re-descarga el código de la app.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions', 'firebase/messaging'],
          react:    ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
