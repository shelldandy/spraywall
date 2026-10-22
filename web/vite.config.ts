import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:8080'
const GIT_SHA = process.env.GIT_SHA?.slice(0, 7)

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(`v${pkg.version}${GIT_SHA ? `+${GIT_SHA}` : ''}`),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Spraywall',
        short_name: 'Spraywall',
        description: 'Spray wall route setting and logbook',
        theme_color: '#007AFF',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/images\//, /^\/healthz/],
        runtimeCaching: [
          {
            // Wall images are addressed by storage key, so they never change.
            urlPattern: ({ url }) => url.pathname.startsWith('/images/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'wall-images',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Offline reads come from the persisted React Query cache instead.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/images': { target: API_TARGET, changeOrigin: true },
    },
  },
})
