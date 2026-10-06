/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Harness pages live at /harness/<module>.html. Vite serves them in dev (multi-page),
// but the production build only includes index.html.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['heic-to'] },
  build: {
    target: 'es2023',
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html') } },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
