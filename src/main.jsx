import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { SettingsProvider } from './context/SettingsContext.jsx'
import { WarehouseProvider } from './context/WarehouseContext.jsx'
import { PageHeaderProvider } from './context/PageHeaderContext.jsx'
import { db } from './db/dexie.js'
import DbOpenErrorScreen from './components/common/DbOpenErrorScreen.jsx'
import BootScreen from './components/common/BootScreen.jsx'
import './index.css'

// Reported: users had to close and reopen the app 3-5 times before a new
// deploy actually showed up. Root cause: nothing in this app ever
// imported vite-plugin-pwa's virtual:pwa-register module, so the plugin
// fell back to its own bare injected registerSW.js (index.html), which
// only calls navigator.serviceWorker.register() - no update polling, no
// reload once a new service worker takes over. A new SW could sit
// "waiting" indefinitely, only getting a real chance to activate on a
// true full close of every open instance, and even then nothing told
// the next launch's already-loaded JS to actually reload and fetch the
// new bundle.
//
// registerSW (workbox-window under the hood) checks for an update
// immediately on load and reloads the page itself the moment a new
// version activates - matches this app's registerType: 'autoUpdate'
// config (vite.config.js), no user-facing prompt needed. workbox-window
// does NOT poll on its own, though (confirmed by reading its source) -
// the explicit visibilitychange listener below is what actually covers
// "reopen the app": every time it becomes visible again, it asks the
// browser to check the real sw.js on the server, which is exactly the
// moment a warehouse worker picking their phone back up should see
// whatever shipped since they last had it open.
let swRegistration = null
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    swRegistration = registration
  },
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') swRegistration?.update()
})

const root = ReactDOM.createRoot(document.getElementById('root'))

// Concept W (picked) - a branded moment instead of a blank flash while
// the database opens (normally near-instant, but not guaranteed - a
// first-time schema migration on a device can take a real moment).
root.render(<BootScreen />)

// Every table read/write implicitly opens the database on first use,
// but an implicit open's failure (a corrupted IndexedDB, a schema
// upgrade function throwing partway through) has nowhere defined to
// surface - it becomes a rejected promise nothing awaits, and the app
// renders a permanently blank/loading screen instead of ever showing
// what's wrong. Opening explicitly here, before the app renders at
// all, gives that failure one place to land: DbOpenErrorScreen, which
// explains it in plain language and offers a real way out.
db.open()
  .then(() => {
    root.render(
      <React.StrictMode>
        <BrowserRouter>
          <AuthProvider>
            <SettingsProvider>
              <WarehouseProvider>
                <PageHeaderProvider>
                  <App />
                </PageHeaderProvider>
              </WarehouseProvider>
            </SettingsProvider>
          </AuthProvider>
        </BrowserRouter>
      </React.StrictMode>,
    )
  })
  .catch((error) => {
    console.error('[main] Database failed to open:', error)
    root.render(<DbOpenErrorScreen error={error} />)
  })
