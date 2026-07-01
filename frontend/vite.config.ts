import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// Vite dev server proxies /api/* to the Hono backend so the browser sees a
// same-origin cookie. Production deploys assume the same origin via the
// Cloudflare Pages → Worker rewrite, so no rewriting needed at runtime.
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'robots.txt'],
      manifest: {
        name: 'HisabMu',
        short_name: 'HisabMu',
        description: 'Platform akuntansi & transparansi lembaga umat',
        theme_color: '#0d9488',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
        // Tanpa ini, SW lama bisa terus menyajikan build basi dari cache
        // walau dev server sudah mati / origin dipakai ulang oleh project
        // lain — SW baru wajib langsung ambil alih & buang cache lama.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3001',
        changeOrigin: false,
        secure: false,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
