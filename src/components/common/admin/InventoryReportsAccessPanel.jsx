// Report Access - Admin only. For each Inventory Reports screen, choose whether a
// Visitor can open it or it is Admin only. An Admin always sees every screen.
// Stored as `inventoryReportsAccess` on the shared reportConfig record; it only
// hides or shows screens, it never changes a figure.

import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import { REPORT_SCREENS, reportAccessOf } from '../../../utils/inventoryReportsAccess.js'

const OPTIONS = [{ value: 'visitor', label: 'Admin and Visitor' }, { value: 'admin', label: 'Admin only' }]

function InventoryReportsAccessPanel() {
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const saved = config?.inventoryReportsAccess

  const setAccess = async (id, value) => {
    if (reportAccessOf(id, saved) === value) return
    const next = Object.fromEntries(REPORT_SCREENS.map((s) => [s.id, reportAccessOf(s.id, saved)]))
    next[id] = value
    try {
      if (config) await db.reportConfig.update('global', { inventoryReportsAccess: next })
      else await db.reportConfig.put({ id: 'global', inventoryReportsAccess: next })
      toast.success(`${REPORT_SCREENS.find((s) => s.id === id).name}: ${value === 'admin' ? 'Admin only' : 'Admin and Visitor'}`)
    } catch (err) {
      console.error(err)
      toast.error('Could not save')
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Report Access</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Choose which Inventory Reports screens a Visitor can open. Admin always sees everything. This only shows or hides a
        screen; no figure changes. Editing prices, opening balances and these settings stays with Admin.
      </p>
      <div className="mt-3 space-y-2">
        {REPORT_SCREENS.map((s) => {
          const current = reportAccessOf(s.id, saved)
          return (
            <div key={s.id} className="rounded-xl border border-neutral-800 bg-neutral-950 p-2">
              <p className="mb-1 text-sm font-medium text-app-text">{s.name}</p>
              <div className="flex gap-2">
                {OPTIONS.map((o) => (
                  <button
                    key={o.value} type="button" onClick={() => setAccess(s.id, o.value)} aria-pressed={current === o.value}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${current === o.value ? 'border-brand-amber bg-brand-amber/10 text-brand-amber' : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700'}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default InventoryReportsAccessPanel
