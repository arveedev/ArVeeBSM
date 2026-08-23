// Shared "palay in / rice out" breakdown for an NFA Ricemill's Regional
// Authority Number - used identically by NfaMillingMonitor.jsx (user-side
// monitor) and RicemillAllocationsPanel.jsx (admin setup panel). Pulled
// into its own file rather than duplicated in both, since this codebase
// has a documented history of exactly that kind of duplication causing
// stale-field bugs once one copy gets fixed and the other doesn't.
//
// Table-like column alignment (Date / AI # / Variety / Net Bags / Net
// Kgs) requires every row to be a DIRECT grid item of ONE shared grid
// container, not a nested div per row - CSS Grid's `auto` column sizing
// is scoped per-container, so nested per-row grids would each size their
// own columns independently and drift out of alignment against each
// other the moment one row's content is wider than another's.

import { fmtWeight, fmtBags } from '../../utils/calculations.js'

const gridCols = 'grid-cols-[64px_72px_1fr_56px_84px]'

function EntryRow({ entry, weightUnit }) {
  return (
    <>
      <span className="truncate text-neutral-500">{entry.date ?? '—'}</span>
      <span className="truncate text-neutral-500">{entry.aiNumber ?? '—'}</span>
      <span className="truncate text-app-text">{entry.varietyName || '—'}</span>
      <span className="text-right tabular-nums text-neutral-400">{fmtBags(entry.bags)}</span>
      <span className="text-right font-medium tabular-nums text-app-text">{fmtWeight(entry.kilos, weightUnit)}</span>
    </>
  )
}

function RecoverySection({ label, entries, totalBags, totalKilos, weightUnit }) {
  if (entries.length === 0) return null
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <div className="overflow-x-auto rounded-lg bg-neutral-950 p-2">
        <div className={`grid ${gridCols} gap-x-2 gap-y-1.5 text-[11px] leading-tight`}>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Date</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">AI #</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Variety</span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Net Bags</span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Net Kgs</span>
          {entries.map((entry) => (
            <EntryRow key={entry.authId} entry={entry} weightUnit={weightUnit} />
          ))}
          <span className="col-span-3 border-t border-neutral-800 pt-1 font-semibold text-app-text">Total</span>
          <span className="border-t border-neutral-800 pt-1 text-right font-semibold tabular-nums text-app-text">{fmtBags(totalBags)}</span>
          <span className="border-t border-neutral-800 pt-1 text-right font-semibold tabular-nums text-app-text">{fmtWeight(totalKilos, weightUnit)}</span>
        </div>
      </div>
    </div>
  )
}

/** recovery: { issuedKilos, issuedBags, recoveredKilos, recoveredBags, recoveryPct, millingEntries, transferEntries } | undefined */
function RicemillRecoveryDetail({ recovery, weightUnit }) {
  if (!recovery) {
    return <p className="text-xs text-neutral-500">No palay-in (milling) or rice-out (transfer) activity recorded yet for this Regional Authority Number.</p>
  }
  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-neutral-950 p-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-neutral-500">{fmtWeight(recovery.issuedKilos, weightUnit)} palay in → {fmtWeight(recovery.recoveredKilos, weightUnit)} rice out</span>
          <span className={`font-semibold ${recovery.recoveryPct == null ? 'text-neutral-500' : 'text-brand-neon'}`}>
            {recovery.recoveryPct == null ? '—' : `${recovery.recoveryPct.toFixed(1)}%`}
          </span>
        </div>
      </div>
      <RecoverySection label="Palay in" entries={recovery.millingEntries} totalBags={recovery.issuedBags} totalKilos={recovery.issuedKilos} weightUnit={weightUnit} />
      <RecoverySection label="Rice out" entries={recovery.transferEntries} totalBags={recovery.recoveredBags} totalKilos={recovery.recoveredKilos} weightUnit={weightUnit} />
    </div>
  )
}

export default RicemillRecoveryDetail
