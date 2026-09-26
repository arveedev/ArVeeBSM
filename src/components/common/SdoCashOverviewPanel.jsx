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

  // Confirmed real correction: Cash on Bank is a single, shared,
  // branch-wide figure (any SDO can update it - see Settings.jsx's
  // SdoCashSection) - not per-SDO, and per explicit correction it's
  // part of the ONE Total CPF figure, not a second separate total.
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const cashOnBank = config?.cashOnBank ?? 0
  const cashOnBankUpdatedLabel = config?.cashOnBankUpdatedAt
    ? `Updated by ${config.cashOnBankUpdatedBy || 'Unknown'} on ${new Date(config.cashOnBankUpdatedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'Not set yet'

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

  const totalCashOnHand = cards.reduce((s, c) => s + c.cashOnHand, 0)
  const totalCpf = totalCashOnHand + cashOnBank

  return (
    <div className="mt-4">
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
        <p className="mt-1 text-2xl font-bold tabular-nums text-app-text">{fmtPeso(totalCpf)}</p>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
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
          {/* Not attributed to any one SDO - shown as its own line,
              distinct from the per-SDO cards above, since it's a shared
              branch figure any of them can update. */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-semibold text-app-text">Cash on Bank <span className="font-normal text-neutral-500">(shared)</span></p>
                <p className="mt-0.5 text-xs text-neutral-500">{cashOnBankUpdatedLabel}</p>
              </div>
              <p className="shrink-0 text-xl font-bold tabular-nums text-app-text">{fmtPeso(cashOnBank)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SdoCashOverviewPanel
