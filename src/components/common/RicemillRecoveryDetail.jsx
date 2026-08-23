// Shared Issuance (palay in) / Receipt (rice out) breakdown for an NFA
// Ricemill's Regional Authority Number - used identically by
// NfaMillingMonitor.jsx (user-side monitor) and
// RicemillAllocationsPanel.jsx (admin setup panel). Pulled into its own
// file rather than duplicated in both, since this codebase has a
// documented history of exactly that kind of duplication causing
// stale-field bugs once one copy gets fixed and the other doesn't.
//
// Table-like column alignment requires every row to be a DIRECT grid
// item of ONE shared grid container, not a nested div per row - CSS
// Grid's `auto` column sizing is scoped per-container, so nested per-row
// grids would each size their own columns independently and drift out
// of alignment against each other the moment one row's content is wider
// than another's.

import { fmtWeight, fmtNetBags } from '../../utils/calculations.js'

const gridColsWithAiNumber = 'grid-cols-[52px_72px_1fr_60px_84px]'
const gridColsNoAiNumber = 'grid-cols-[52px_1fr_60px_84px]'

/** "2026-07-31" -> "26-07-31" - drops the century so the column stays
 * narrow enough to never truncate; the last two digits of the year are
 * kept (not dropped entirely) since activity can span a year boundary. */
function shortDate(isoDate) {
  if (!isoDate) return '—'
  const s = String(isoDate)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(2, 10) : s
}

function EntryRow({ entry, weightUnit, showAiNumber }) {
  return (
    <>
      <span className="text-neutral-500">{shortDate(entry.date)}</span>
      {showAiNumber && <span className="truncate text-neutral-500">{entry.aiNumber ?? '—'}</span>}
      <span className="truncate text-app-text">{entry.varietyName || '—'}</span>
      <span className="text-right tabular-nums text-neutral-400">{fmtNetBags(entry.bags)}</span>
      <span className="text-right font-medium tabular-nums text-app-text">{fmtWeight(entry.kilos, weightUnit)}</span>
    </>
  )
}

/** showAiNumber: false for Issuance - there's only ever one AI covering
 * the whole allocation, so a per-row AI # column has nothing useful to
 * show. Receipt keeps it - each row is its own real, distinct AI. */
function RecoverySection({ label, entries, totalBags, totalKilos, weightUnit, showAiNumber }) {
  if (entries.length === 0) return null
  const gridCols = showAiNumber ? gridColsWithAiNumber : gridColsNoAiNumber
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <div className="overflow-x-auto rounded-lg bg-neutral-950 p-2">
        <div className={`grid ${gridCols} gap-x-2 gap-y-1.5 text-[11px] leading-tight`}>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Date</span>
          {showAiNumber && <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">AI #</span>}
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Variety</span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Net Bags</span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Net Kgs</span>
          {entries.map((entry) => (
            <EntryRow key={entry.authId} entry={entry} weightUnit={weightUnit} showAiNumber={showAiNumber} />
          ))}
          <span className={`${showAiNumber ? 'col-span-3' : 'col-span-2'} border-t border-neutral-800 pt-1 font-semibold text-app-text`}>Total</span>
          <span className="border-t border-neutral-800 pt-1 text-right font-semibold tabular-nums text-app-text">{fmtNetBags(totalBags)}</span>
          <span className="border-t border-neutral-800 pt-1 text-right font-semibold tabular-nums text-app-text">{fmtWeight(totalKilos, weightUnit)}</span>
        </div>
      </div>
    </div>
  )
}

/** recovery: { issuedKilos, issuedBags, recoveredKilos, recoveredBags, recoveryPct, millingEntries, transferEntries } | undefined */
function RicemillRecoveryDetail({ recovery, weightUnit }) {
  if (!recovery) {
    return <p className="text-xs text-neutral-500">No Issuance (palay in) or Receipt (rice out) activity recorded yet for this Regional Authority Number.</p>
  }
  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-neutral-950 p-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-neutral-500">{fmtWeight(recovery.issuedKilos, weightUnit)} issued → {fmtWeight(recovery.recoveredKilos, weightUnit)} received</span>
          <span className={`font-semibold ${recovery.recoveryPct == null ? 'text-neutral-500' : 'text-brand-neon'}`}>
            {recovery.recoveryPct == null ? '—' : `${recovery.recoveryPct.toFixed(1)}%`}
          </span>
        </div>
      </div>
      <RecoverySection label="Issuance" entries={recovery.millingEntries} totalBags={recovery.issuedBags} totalKilos={recovery.issuedKilos} weightUnit={weightUnit} showAiNumber={false} />
      <RecoverySection label="Receipt" entries={recovery.transferEntries} totalBags={recovery.recoveredBags} totalKilos={recovery.recoveredKilos} weightUnit={weightUnit} showAiNumber />
    </div>
  )
}

export default RicemillRecoveryDetail
