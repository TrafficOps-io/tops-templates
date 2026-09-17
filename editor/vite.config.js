import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    includeAssets: ['favicon.svg', 'pwa-icon-192.png', 'pwa-icon-512.png', 'pwa-icon-maskable-512.png'],
    manifest: {
      id: '/',
      name: 'Landing Studio by TrafficOps',
      short_name: 'Landing Studio',
      description: 'Create, edit, and generate TrafficOps template projects locally.',
      start_url: '/?studio=1',
      scope: '/',
      display: 'standalone',
      display_override: ['standalone'],
      background_color: '#1d1a19',
      theme_color: '#1d1a19',
      icons: [
        { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/pwa-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{html,js,css,svg,png,webmanifest,woff,woff2,ttf}'],
      navigateFallback: '/index.html',
      cleanupOutdatedCaches: true,
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    },
    devOptions: { enabled: true, type: 'module' },
  })],
  worker: { format: 'es' },
  // Reuse the VS Code extension's standalone language model and formatter.
  optimizeDeps: { include: ['tops-templates/src/language.js', 'tops-templates/src/formatter.js'] },
  build: { target: 'es2022', commonjsOptions: { include: [/node_modules/, /vscode-extension\/src\//] } },
});
