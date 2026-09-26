// SdoCashOverviewPanel — Admin/Visitor-only overview of every SDO's
// current Cash on Hand, added to Monitoring's Procurement tab per
// explicit request ("so the visitors can see how much cash each SDO
// have on hand"). Purely read-only, no writes anywhere in this file.
//
// Reuses computeCashOnHand (sdoCalculations.js) exactly as SdoHome.jsx
// does for the logged-in SDO's own figure - the same proven math, just
// run once per SDO user here instead of once for "me" there. Never a
// second, independently-written calculation that could drift from it.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { computeCashOnHand } from '../../utils/sdoCalculations.js'
import { byAlpha } from './admin/shared.js'

const fmtPeso = (n) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function SdoCashOverviewPanel() {
  // Per explicit request: the per-SDO breakdown doesn't show by default -
  // only the combined total card does, and tapping it expands/collapses
  // the list below, same summary-row convention as ProcurementMonitor.jsx's
  // own card list.
  const [expanded, setExpanded] = useState(false)
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
        // Plain, manually-entered field on the user record (see
        // Settings.jsx's SdoCashSection) - never derived from the
        // ledger the way Cash on Hand is, so it's read straight off
        // the user record with no computation here.
        cashOnBank: u.cashOnBank ?? 0,
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
  const totalCashOnBank = cards.reduce((s, c) => s + c.cashOnBank, 0)

  return (
    <div className="mt-4">
      {/* Two separate totals, per explicit request - CPF (ledger-
          derived) and Cash on Bank (manually entered per SDO in their
          own Settings) are deliberately never merged into one figure.
          Either card expands/collapses the same shared per-SDO
          breakdown below, which shows both figures per SDO. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full rounded-xl border border-brand-neon/40 bg-brand-neon/5 px-4 py-3 text-left transition-colors hover:border-brand-neon/70"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-neon">Total CPF — All SDOs</p>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-neutral-500">
                {cards.length} {cards.length === 1 ? 'SDO' : 'SDOs'}
              </span>
              <ChevronDown size={16} className={`text-neutral-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </div>
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-app-text">{fmtPeso(totalCash)}</p>
        </button>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-left transition-colors hover:border-neutral-600"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">Total Cash on Bank — All SDOs</p>
            <ChevronDown size={16} className={`shrink-0 text-neutral-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-app-text">{fmtPeso(totalCashOnBank)}</p>
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          {cards.map((c) => (
            <div key={c.uid} className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
              <p className="truncate text-base font-semibold text-app-text">{c.name}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-neutral-500">CPF</p>
                  <p className={`text-lg font-bold tabular-nums ${c.cashOnHand < 0 ? 'text-brand-crimson' : 'text-app-text'}`}>
                    {fmtPeso(c.cashOnHand)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-neutral-500">Cash on Bank</p>
                  <p className="text-lg font-bold tabular-nums text-app-text">{fmtPeso(c.cashOnBank)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default SdoCashOverviewPanel
