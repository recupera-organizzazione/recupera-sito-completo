import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Nel sito completo la dashboard vive su /dashboard/ dietro il gateway (gateway/server.js)
// e le API sono su /dashboard/api/v1 (src/lib/api.js usa BASE_URL).
export default defineConfig({
  base: '/dashboard/',
  plugins: [react()],
  server: {
    port: 5180,
    // Il design system condiviso sta fuori dalla cartella dell'app (../../design).
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
    // Proxy per l'uso diretto su :5173 senza gateway: /dashboard/api → backend Express /api.
    // Backend target: porta 3101 come in scripts/avvia.mjs (DASHBOARD_API_PORT).
    proxy: {
      '/dashboard/api': {
        target: process.env.DASHBOARD_API_URL || 'http://localhost:3101',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dashboard/, ''),
      },
    },
  },
});
