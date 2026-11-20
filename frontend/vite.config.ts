import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local dev: the Vite dev server proxies /api and /socket.io to the NestJS backend,
// so cookies stay same-origin. In production set VITE_API_URL to the backend URL.
const API = process.env.VITE_DEV_API ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@uzuz/shared': fileURLToPath(new URL('./src/shared/index.ts', import.meta.url))
    }
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/socket.io': { target: API, ws: true, changeOrigin: false }
    }
  },
  preview: { port: 4173 },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['motion'],
          i18n: ['i18next', 'react-i18next']
        }
      }
    }
  }
});
