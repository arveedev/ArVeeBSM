// SdoCashOverviewPanel — Admin/Visitor-only overview of every SDO's
// current Cash on Hand, added to Monitoring's Procurement tab per
// explicit request ("so the visitors can see how much cash each SDO
// have on hand"). Purely read-only, no writes anywhere in this file.
//
// Reuses computeCashOnHand (sdoCalculations.js) exactly as SdoHome.jsx
// does for the logged-in SDO's own figure - the same proven math, just
// run once per SDO user here instead of once for "me" there. Never a
// second, independently-written calculation that could drift from it.

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie.js'
import { computeCashOnHand } from '../../utils/sdoCalculations.js'
import { byAlpha } from './admin/shared.js'

const fmtPeso = (n) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function SdoCashOverviewPanel() {
  const sdoUsers = useLiveQuery(() => db.users.where('role').equals('SDO').toArray(), []) ?? []

  // Both tables are small (one row per cash-ledger entry / currently-
  // Active purchase receipt across the WHOLE system) - fetched once here
  // and grouped by sdoUid client-side, rather than one query per SDO.
  const allLedgerEntries = useLiveQuery(() => db.cashLedgerV2.toArray(), []) ?? []
  const allActivePrs = useLiveQuery(() => db.purchaseReceipts.where('status').equals('Active').toArray(), []) ?? []

  const cards = sdoUsers
    .map((u) => {
      const myLedger = allLedgerEntries.filter((e) => e.sdoUid === u.uid)
      const myPrTotals = allActivePrs.filter((pr) => pr.sdoUid === u.uid).map((pr) => pr.totalAmount ?? 0)
      return {
        uid: u.uid,
        name: u.name || u.accessCode || 'Unnamed SDO',
        cashOnHand: computeCashOnHand(myLedger, myPrTotals),
      }
    })
    .sort((a, b) => byAlpha(a.name, b.name))

  if (sdoUsers.length === 0) {
    return (
      <p className="mt-6 py-8 text-center text-sm text-neutral-600">
        No SDO accounts configured.
      </p>
    )
  }

  const totalCash = cards.reduce((s, c) => s + c.cashOnHand, 0)

  return (
    <div className="mt-4">
      <div className="mb-3 rounded-xl border border-brand-neon/40 bg-brand-neon/5 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-neon">Total Cash on Hand — All SDOs</p>
          <span className="shrink-0 text-xs text-neutral-500">
            {cards.length} {cards.length === 1 ? 'SDO' : 'SDOs'}
          </span>
        </div>
        <p className="mt-1 text-2xl font-bold tabular-nums text-app-text">{fmtPeso(totalCash)}</p>
      </div>

      <div className="space-y-2">
        {cards.map((c) => (
          <div key={c.uid} className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-app-text">{c.name}</p>
              </div>
              <p className={`shrink-0 text-xl font-bold tabular-nums ${c.cashOnHand < 0 ? 'text-brand-crimson' : 'text-app-text'}`}>
                {fmtPeso(c.cashOnHand)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default SdoCashOverviewPanel
