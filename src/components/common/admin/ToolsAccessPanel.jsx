// Tools Access - Admin only. Who can open the Report Builder: the Admin always can; Analysts and warehouse staff can unless switched off here.
// A Visitor and the SDO can never open it. Stored as `toolsAccess` on the shared reportConfig record. It only shows or hides the tool;
// the Builder itself is read-only and never changes a record.

import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'

const ROWS = [
  { key: 'analyst', label: 'Analysts', note: 'See every warehouse.' },
  { key: 'staff', label: 'Warehouse staff (Supervisor, Assistant, MPO III, and the acting ones)', note: 'See only their own warehouses.' },
]

function ToolsAccessPanel() {
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const rb = config?.toolsAccess?.reportBuilder ?? {}
  const on = (k) => rb[k] !== false

  const toggle = async (k) => {
    const next = { ...(config?.toolsAccess ?? {}), reportBuilder: { analyst: on('analyst'), staff: on('staff'), [k]: !on(k) } }
    try {
      if (config) await db.reportConfig.update('global', { toolsAccess: next })
      else await db.reportConfig.put({ id: 'global', toolsAccess: next })
      toast.success(`Report Builder for ${ROWS.find((r) => r.key === k).label.split(' (')[0]}: ${next.reportBuilder[k] ? 'on' : 'off'}`)
    } catch (err) {
      console.error(err)
      toast.error('Could not save')
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Tools Access: Report Builder</h2>
      <p className="mt-1 text-xs text-neutral-400">
        The Report Builder lets a person make their own tables and pivot tables from the app&apos;s records, and export them. It is read-only: it
        cannot add, change or delete anything. The Admin always has it. A Visitor and the SDO never do. Every export is recorded in the
        Report export log (Report Builder, data source &quot;Report export log&quot;).
      </p>
      <div className="mt-3 space-y-2">
        {ROWS.map((r) => (
          <label key={r.key} className="flex items-start justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
            <span className="min-w-0 text-sm text-app-text">{r.label}<span className="block text-xs text-neutral-500">{r.note}</span></span>
            <input type="checkbox" checked={on(r.key)} onChange={() => toggle(r.key)} className="mt-1 h-5 w-5 shrink-0 accent-[#00FFA3]" aria-label={`${r.label} can use the Report Builder`} />
          </label>
        ))}
      </div>
    </section>
  )
}

export default ToolsAccessPanel
