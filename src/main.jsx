import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { SettingsProvider } from './context/SettingsContext.jsx'
import { WarehouseProvider } from './context/WarehouseContext.jsx'
import { PageHeaderProvider } from './context/PageHeaderContext.jsx'
import { db } from './db/dexie.js'
import { initAppUpdate, checkForUpdate } from './services/appUpdate.js'
import DbOpenErrorScreen from './components/common/DbOpenErrorScreen.jsx'
import BootScreen from './components/common/BootScreen.jsx'
import './index.css'

// Registers the service worker (installs a new one in the background
// when a deploy ships, but never reloads on its own - see
// appUpdate.js's and vite.config.js's own comments for the reported bug
// this fixes: an earlier 'autoUpdate' config force-reloaded the page
// the instant a new version activated, with no say from the user,
// mid-work or not - and starved UpdateChecker.jsx's own toast of any
// chance to show, since the silent reload had usually already happened
// by the time its poll ran). checkForUpdate() on visibilitychange is
// what actually covers "reopen the app" - workbox-window has no polling
// of its own, confirmed by reading its source - every time the app
// becomes visible again, it asks the browser to check the real sw.js on
// the server, which is exactly the moment a warehouse worker picking
// their phone back up should find out something shipped since they
// last had it open (UpdateChecker.jsx's own version.json poll is what
// actually surfaces that to the user; this only keeps the service
// worker itself current so applying an update later is fast).
initAppUpdate()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate()
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
