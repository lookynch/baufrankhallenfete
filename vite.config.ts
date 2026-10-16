import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { pwaManifests } from './scripts/pwa-manifests.ts';

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  plugins: [react(), tailwindcss(), pwaManifests()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${process.env.SMOKE_PORT ?? 8799}`,
    },
  },
});
