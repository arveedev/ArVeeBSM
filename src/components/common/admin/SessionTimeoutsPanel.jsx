// Session Timeouts — Admin only. Per explicit request: an entry form
// left idle auto-closes back to Home, and if the whole app stays idle
// even longer, a non-Admin/Visitor session (SDO, Warehouse Supervisor,
// etc.) is automatically logged out. Both are read from db.reportConfig
// 'global' (formInactivityTimeoutSec/logoutInactivityTimeoutSec) by
// App.jsx's idle hooks and PurchaseReceiptModal.jsx's own, with 60s/300s
// defaults if never configured here.

import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import { inputClass, labelClass, primaryButtonClass } from './shared.js'

const DEFAULT_FORM_TIMEOUT_SEC = 60
const DEFAULT_LOGOUT_TIMEOUT_SEC = 300

function SessionTimeoutsPanel() {
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const [formTimeout, setFormTimeout] = useState('')
  const [logoutTimeout, setLogoutTimeout] = useState('')

  useEffect(() => {
    if (!config) return
    setFormTimeout(String(config.formInactivityTimeoutSec ?? DEFAULT_FORM_TIMEOUT_SEC))
    setLogoutTimeout(String(config.logoutInactivityTimeoutSec ?? DEFAULT_LOGOUT_TIMEOUT_SEC))
  }, [config?.id])

  const handleSave = async () => {
    const formSec = parseInt(formTimeout, 10)
    const logoutSec = parseInt(logoutTimeout, 10)
    if (!Number.isFinite(formSec) || formSec < 10) {
      toast.error('Form auto-exit must be at least 10 seconds')
      return
    }
    if (!Number.isFinite(logoutSec) || logoutSec <= formSec) {
      toast.error('Auto-logout must be longer than the form auto-exit time')
      return
    }
    await db.reportConfig.put({
      ...(config ?? { id: 'global' }),
      formInactivityTimeoutSec: formSec,
      logoutInactivityTimeoutSec: logoutSec,
    })
    toast.success('Session timeouts updated')
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Session Timeouts</h2>
      <p className="mt-1 text-xs text-neutral-400">
        If an entry form sits idle, it warns, then auto-closes back to Home.
        If the whole app then stays idle even longer, an SDO/Warehouse
        session is automatically logged out - Admin and Visitor sessions
        are exempt from auto-logout.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Form Auto-Exit (seconds)</label>
          <input
            type="number"
            min="10"
            value={formTimeout}
            onChange={(e) => setFormTimeout(e.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-neutral-500">Default 60s.</p>
        </div>
        <div>
          <label className={labelClass}>Auto-Logout (seconds)</label>
          <input
            type="number"
            min="30"
            value={logoutTimeout}
            onChange={(e) => setLogoutTimeout(e.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-neutral-500">Default 300s (5 min).</p>
        </div>
      </div>

      <button type="button" onClick={handleSave} className={`mt-4 w-full ${primaryButtonClass}`}>
        Save
      </button>
    </section>
  )
}

export default SessionTimeoutsPanel
