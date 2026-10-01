// Stock Statement kilos precision — admin-configurable toggle between 2 and
// 3 decimal places for the exported Stock Statement's kilos figures (Summary,
// Statement, and Recap pages - see pdfGenerator.js's `decimals` param on
// generateNfaReport/addStockSummaryPage/addStockStatementPage/
// addStockRecapPage). Nothing else in the app (every other report, the
// sack-weight label, all on-screen displays) is affected by this toggle.
//
// Stored on the same global reportConfig record (id: 'global') the
// Signatories/Data Start Date panels already manage - stockStatementDecimals
// is a new field on it, no schema migration needed since Dexie only
// requires migrations for INDEXED fields. Defaults to 2 (the app's current
// behavior) when unset.

import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import { labelClass } from './shared.js'

function StockReportDecimalsPanel() {
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const decimals = config?.stockStatementDecimals ?? 2

  const setDecimals = async (value) => {
    if (value === decimals) return
    if (config) {
      await db.reportConfig.update('global', { stockStatementDecimals: value })
    } else {
      await db.reportConfig.put({ id: 'global', stockStatementDecimals: value })
    }
    toast.success(`Stock Statement kilos now export at ${value} decimal places`)
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Stock Report Decimals</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Controls how many decimal places the exported Stock Statement's kilos figures (Summary,
        Statement, and Recap pages) show and compute with. Every other report, and the sack/MTS
        weight label elsewhere in the app, is unaffected.
      </p>

      <div className="mt-3">
        <label className={labelClass}>Kilos Precision</label>
        <div className="mt-1 flex gap-2">
          {[2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setDecimals(n)}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                decimals === n
                  ? 'border-brand-amber bg-brand-amber/10 text-brand-amber'
                  : 'border-neutral-800 bg-neutral-950 text-neutral-300 hover:border-neutral-700'
              }`}
            >
              {n} decimals
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

export default StockReportDecimalsPanel
