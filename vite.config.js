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
      // 'prompt', not 'autoUpdate' - reported, real bug: 'autoUpdate'
      // makes vite-plugin-pwa's own registerSW() reload the page the
      // INSTANT a new service worker activates, with zero say from the
      // user - no toast, no confirmation, mid-work or not. This is
      // exactly why the "Update now" toast (UpdateChecker.jsx) never
      // got a chance to show on a real phone: the silent auto-reload
      // already happened (often within seconds of opening the app) and
      // put the device on the new version before the periodic
      // version.json poll ever found a mismatch to report. 'prompt'
      // installs the new service worker and lets it sit WAITING -
      // nothing reloads until the user's own tap on "Update now" calls
      // the update function returned by registerSW() (see main.jsx),
      // so a reload can never interrupt someone mid-search or
      // mid-reconciliation without their say-so.
      registerType: 'prompt',
      manifest: false,
      workbox: {
        // Reported, real bug found by reading the generated dist/sw.js
        // directly: skipWaiting was correctly gated behind a message
        // listener (registerType: 'prompt' does that automatically), so
        // tapping "Update now" DID successfully activate the new
        // service worker in the background every time - but without
        // clientsClaim, an activated worker never takes control of an
        // ALREADY OPEN tab on its own. That meant navigator.
        // serviceWorker.controller never changed for the page still
        // open, so the 'controllerchange' event workbox-window listens
        // for (to trigger the actual reload - see appUpdate.js) never
        // fired. The update was silently succeeding in the background
        // on every tap, with nothing ever telling the open page to
        // reload and show it - exactly "tapping Update now does
        // nothing, repeatedly." clientsClaim: true here does NOT change
        // WHEN a new worker activates (that's still only ever triggered
        // by the user's own tap, via the message listener above) - it
        // only makes activation actually take effect on the open tab
        // once it happens, instead of silently doing nothing until a
        // future unrelated navigation.
        clientsClaim: true,
        // Every deep route (e.g. /reports) is client-side (BrowserRouter)
        // - there's no server to resolve it while offline, so any
        // navigation not already in the precache falls back to the
        // cached index.html, which then lets React Router take over.
        navigateFallback: '/index.html',
        // Left at the plugin's own default (js/css/html only), the
        // precache silently excluded every static image in public/ -
        // logo, favicons, app icons, the manifest itself - confirmed
        // directly: the logo didn't render at all once actually tested
        // offline. Every one of those needs to be precached too, not
        // just the app's own compiled code.
        // woff2 added for the self-hosted Inter font files (see
        // index.css) - without it, the CSS itself would be cached but
        // the actual font files it points to would not be, producing
        // the exact same "silently falls back to a system font
        // offline" gap this was meant to close. .woff (the older,
        // larger fallback format) deliberately left out of the
        // precache - every browser this PWA can even install on
        // already supports woff2, which every @font-face rule here
        // lists first and browsers always prefer when available, so
        // the plain .woff files precaching would add is dead weight
        // that's never actually used.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
        // @fontsource ships every unicode subset Inter has (cyrillic,
        // greek, vietnamese, etc.) in one CSS file, each gated by its
        // own unicode-range so a normal browser only ever actually
        // fetches the ones it needs (latin/latin-ext, for this English/
        // Filipino-names app) - but Workbox's precache doesn't
        // understand unicode-range at all, it just globs every file
        // unconditionally. Left alone this pulled in ~1MB+ of font
        // subsets (Cyrillic, Greek, Vietnamese) this app will never
        // render a single character from. Excluded here rather than
        // trimmed from the CSS import itself, so a browser encountering
        // a genuinely unusual character still has a real font to fall
        // back to when online - it just isn't force-downloaded upfront.
        globIgnores: ['**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*'],
      },
    }),
  ],
})
