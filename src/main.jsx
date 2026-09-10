import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { SettingsProvider } from './context/SettingsContext.jsx'
import { WarehouseProvider } from './context/WarehouseContext.jsx'
import { PageHeaderProvider } from './context/PageHeaderContext.jsx'
import { db } from './db/dexie.js'
import DbOpenErrorScreen from './components/common/DbOpenErrorScreen.jsx'
import BootScreen from './components/common/BootScreen.jsx'
import './index.css'

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
