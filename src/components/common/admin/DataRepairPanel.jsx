// Data Repair — Admin only. One-time tool for transactions whose stored
// cerealCategory disagrees with their own variety's category (e.g. a
// Rice-variety WSR filed under Palay), left behind by StockFormBase's
// old category-less serial fallback (fixed in v1.10-252) and possibly
// older Sheet imports. The record's variety is the truth (it's what the
// entry form's tab already follows), so Repair rewrites cerealCategory
// to match it. Scan first, repair only on confirmation - and the scan
// lists exactly what would change.

import { useState } from 'react'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { primaryButtonClass, secondaryButtonClass } from './shared.js'

function DataRepairPanel() {
  const [scanning, setScanning] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [mismatches, setMismatches] = useState(null) // null = not scanned yet
  const [confirming, setConfirming] = useState(false)

  const handleScan = async () => {
    setScanning(true)
    try {
      const varieties = await db.varietyTypes.toArray()
      const categoryByVariety = new Map(varieties.map((v) => [v.varietyId, v.category]))
      const found = []
      await db.transactions.each((t) => {
        if (!t.varietyId || !t.cerealCategory) return
        const truth = categoryByVariety.get(t.varietyId)
        if (truth && truth !== t.cerealCategory) {
          found.push({ id: t.id, type: t.type, serialNo: t.serialNo, warehouseId: t.warehouseId, date: t.date, from: t.cerealCategory, to: truth })
        }
      })
      setMismatches(found)
    } catch (err) {
      console.error(err)
      toast.error('Scan failed - check console')
    } finally {
      setScanning(false)
    }
  }

  const handleRepair = async () => {
    setConfirming(false)
    setRepairing(true)
    try {
      for (const m of mismatches) await db.transactions.update(m.id, { cerealCategory: m.to })
      toast.success(`Repaired ${mismatches.length} record${mismatches.length === 1 ? '' : 's'}`)
      setMismatches([])
    } catch (err) {
      console.error(err)
      toast.error('Repair failed part-way - scan again to see what remains')
    } finally {
      setRepairing(false)
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Data Repair</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Finds stock transactions filed under the wrong cereal tab - e.g. a Rice-variety WSR stored as Palay,
        which makes the Palay tab on the entry form open that record instead of a blank one. Each record's own
        variety decides the correct category. Nothing changes until you confirm.
      </p>

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={handleScan} disabled={scanning || repairing} className={`flex-1 ${secondaryButtonClass} disabled:opacity-40`}>
          {scanning ? 'Scanning…' : 'Scan for mismatches'}
        </button>
        {mismatches?.length > 0 && (
          <button type="button" onClick={() => setConfirming(true)} disabled={repairing} className={`flex-1 ${primaryButtonClass} disabled:opacity-40`}>
            {repairing ? 'Repairing…' : `Repair ${mismatches.length}`}
          </button>
        )}
      </div>

      {mismatches && (
        <div className="mt-3">
          <p className="text-sm font-medium text-app-text">
            {mismatches.length === 0 ? 'No mismatched records found.' : `${mismatches.length} mismatched record${mismatches.length === 1 ? '' : 's'}`}
          </p>
          {mismatches.length > 0 && (
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs text-neutral-400">
              {mismatches.map((m) => (
                <li key={m.id} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5">
                  <span className="font-semibold text-app-text">{m.type} {m.serialNo}</span> · {m.date} · {m.from} → <span className="text-brand-neon">{m.to}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Repair ${mismatches?.length ?? 0} record${mismatches?.length === 1 ? '' : 's'}?`}
        description="Each listed record's cereal category will be rewritten to match its own variety. This syncs to every device."
        confirmLabel="Repair"
        onConfirm={handleRepair}
        onCancel={() => setConfirming(false)}
      />
    </section>
  )
}

export default DataRepairPanel
