import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // Makes the app shell (HTML/JS/CSS) itself available offline, not
    // just the data (Dexie/IndexedDB already handled that side). Without
    // this, closing the app fully while offline and reopening it relied
    // entirely on the browser's own opportunistic HTTP cache - not
    // durable, not guaranteed, and a real risk for exactly the case this
    // app is built for (a warehouse worker with no signal). manifest:
    // false - public/manifest.webmanifest already exists and is already
    // linked directly in index.html; this plugin only adds the service
    // worker + precaching on top of it, not a second manifest.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        // Every deep route (e.g. /reports) is client-side (BrowserRouter)
        // - there's no server to resolve it while offline, so any
        // navigation not already in the precache falls back to the
        // cached index.html, which then lets React Router take over.
        navigateFallback: '/index.html',
      },
    }),
  ],
})
