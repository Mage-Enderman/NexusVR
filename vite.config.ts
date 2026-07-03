import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mkcert from 'vite-plugin-mkcert';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mkcert()],
  base: './', // Essential for GitHub Pages static deployment
  server: {
    host: true, // Allow external device connections (Quest, Phone over LAN)
    port: 5173,
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('three') || id.includes('@pixiv')) return 'three-vrm';
            return 'vendor';
          }
        }
      }
    }
  },
});
