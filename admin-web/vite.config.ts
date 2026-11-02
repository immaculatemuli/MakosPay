import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dashboard lives at /office/ and talks to the FarePay API at the same address:
//  - in development Vite forwards the API paths to the backend (yarn dev in backend/, port 4000);
//  - in production the backend serves the built files itself (backend/src/app.js).
// changeOrigin stays false so the backend sees the browser's own address (its forged-request check needs that).
const API = process.env.FAREPAY_API ?? 'http://localhost:4000';
const forward = { target: API, changeOrigin: false };

export default defineConfig({
  base: '/office/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/auth': forward, '/admin': forward, '/platform': forward, '/notifications': forward, '/health': forward },
  },
  build: { outDir: 'dist', sourcemap: false },
});
