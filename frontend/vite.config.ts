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
        // Without this, the SW's navigation fallback swallows /api/* too —
        // every top-level GET navigation (not just SPA routes) gets served
        // cached index.html instead of hitting the network. That includes
        // the Google OAuth callback redirect (a real page navigation, not a
        // fetch), so the auth code/state never reached the backend at all;
        // it just silently landed back on the SPA shell every time.
        // /transparansi/* (laporan publik untuk jamaah) juga di-denylist:
        // link itu dibuka lewat navigasi penuh dari WhatsApp/tab baru, dan
        // kalau service worker pengunjung lama rusak/cache-nya hilang,
        // handler navigasi SW bisa gagal dan Chrome menampilkan "This site
        // can't be reached (ERR_FAILED)" padahal server sehat. Dilewatkan
        // langsung ke jaringan: Cloudflare Pages sudah menyajikan
        // index.html (SPA fallback via public/_redirects), jadi halaman
        // publik tidak bergantung pada kesehatan SW sama sekali.
        navigateFallbackDenylist: [/^\/api\//, /^\/transparansi(\/|$)/],
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
