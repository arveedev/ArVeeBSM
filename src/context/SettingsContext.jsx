// Settings context — client configuration toggles consumed by the dynamic
// age monitoring logic (Section 4.2) and other configurable behaviors.
// Persisted in a Dexie `settings` record (id: 'global') so they survive
// page refreshes without needing to log out and back in.

import { createContext, useContext, useEffect, useState } from 'react'
import { db } from '../db/dexie.js'

const SettingsContext = createContext(null)

const DEFAULTS = {
  autoAgeMonitoring: true,
  theme: 'dark',
  weightUnit: 'kg', // 'kg' (net kilos) or 'mt' (metric tons)
}

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    db.table('settings')
      .get('global')
      .then((saved) => {
        if (saved) {
          // weightUnit is intentionally excluded from what's restored -
          // it always starts back at the default (kg) on every fresh
          // load, per explicit request, even though it's still saved
          // to Dexie for the update mechanism to work during a session.
          const { weightUnit, ...rest } = saved
          setSettings((prev) => ({ ...prev, ...rest }))
        }
      })
      .catch(() => {
        // Table may not exist in older schema versions — default is fine.
      })
      .finally(() => setLoaded(true))
  }, [])

  const updateSetting = async (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    try {
      const current = (await db.table('settings').get('global')) ?? { id: 'global' }
      await db.table('settings').put({ ...current, id: 'global', [key]: value })
    } catch {
      // Non-fatal — preference lives in memory this session.
    }
  }

  if (!loaded) return null

  return (
    <SettingsContext.Provider value={{ ...settings, updateSetting }}>
      {children}
    </SettingsContext.Provider>
  )
}

export const useSettings = () => useContext(SettingsContext)
