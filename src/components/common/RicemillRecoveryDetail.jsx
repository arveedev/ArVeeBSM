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

// Issuance has no AI # (there's only ever one AI covering the whole
// allocation - a per-row AI # would have nothing useful to show) and no
// Variety column (every row is the same static "derived from mill
// capacity" placeholder, not a real per-row value worth its own
// column). Receipt keeps both - each row is its own real, distinct AI
// and variety.
const ISSUANCE_COLUMNS = ['date', 'netBags', 'netKgs']
const RECEIPT_COLUMNS = ['date', 'aiNumber', 'variety', 'netBags', 'netKgs']

// Tailwind's build-time scanner only picks up class names it can see as
// literal strings in the source - a runtime-concatenated
// `grid-cols-[${...}]` would never make it into the generated CSS at
// all, so these stay as two fully static strings, picked by column
// count, rather than assembled from COLUMN_WIDTH at render time.
const GRID_COLS_BY_LENGTH = {
  3: 'grid-cols-[52px_60px_84px]',
  5: 'grid-cols-[52px_72px_1fr_60px_84px]',
}

const COLUMN_LABEL = { date: 'Date', aiNumber: 'AI #', variety: 'Variety', netBags: 'Net Bags', netKgs: 'Net Kgs' }
const RIGHT_ALIGNED = new Set(['netBags', 'netKgs'])

/** "2026-07-31" -> "26-07-31" - drops the century so the column stays
 * narrow enough to never truncate; the last two digits of the year are
 * kept (not dropped entirely) since activity can span a year boundary. */
function shortDate(isoDate) {
  if (!isoDate) return '—'
  const s = String(isoDate)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(2, 10) : s
}

function cellContent(column, entry, weightUnit) {
  switch (column) {
    case 'date': return shortDate(entry.date)
    case 'aiNumber': return entry.aiNumber ?? '—'
    case 'variety': return entry.varietyName || '—'
    case 'netBags': return fmtNetBags(entry.bags)
    case 'netKgs': return fmtWeight(entry.kilos, weightUnit)
    default: return ''
  }
}

function RecoverySection({ label, entries, totalBags, totalKilos, weightUnit, columns }) {
  if (entries.length === 0) return null
  const gridCols = GRID_COLS_BY_LENGTH[columns.length]
  const leadColSpan = columns.length - 2 // every column except Net Bags/Net Kgs, for the "Total" label
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <div className="overflow-x-auto rounded-lg bg-neutral-950 p-2">
        <div className={`grid ${gridCols} gap-x-2 gap-y-1.5 text-[11px] leading-tight`}>
          {columns.map((col) => (
            <span key={col} className={`text-[10px] font-semibold uppercase tracking-wide text-neutral-600 ${RIGHT_ALIGNED.has(col) ? 'text-right' : ''}`}>
              {COLUMN_LABEL[col]}
            </span>
          ))}
          {entries.map((entry) => (
            <>
              {columns.map((col) => (
                <span
                  key={col}
                  className={
                    RIGHT_ALIGNED.has(col)
                      ? `text-right tabular-nums ${col === 'netKgs' ? 'font-medium text-app-text' : 'text-neutral-400'}`
                      : `truncate ${col === 'variety' ? 'text-app-text' : 'text-neutral-500'}`
                  }
                >
                  {cellContent(col, entry, weightUnit)}
                </span>
              ))}
            </>
          ))}
          <span className="border-t border-neutral-800 pt-1 font-semibold text-app-text" style={{ gridColumn: `span ${leadColSpan}` }}>Total</span>
          <span className="border-t border-neutral-800 pt-1 text-right font-semibold tabular-nums text-app-text">{fmtNetBags(totalBags)}</span>
          <span className="border-t border-neutral-800 pt-1 text-right font-semibold tabular-nums text-app-text">{fmtWeight(totalKilos, weightUnit)}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * "Used of total" and "Remaining" as two separate lines (not crammed
 * inline) - Remaining shown in BOTH Net Kgs and Net Bags, matching the
 * rest of this screen's units. Shared between NfaMillingMonitor.jsx and
 * RicemillAllocationsPanel.jsx's NFA section.
 */
export function AllocationUsageSummary({ used, total, weightUnit }) {
  const remaining = total - used
  const isOver = remaining < 0
  const remainingAbs = Math.abs(remaining)
  return (
    <div className="text-xs text-neutral-500">
      <p>{fmtWeight(used, weightUnit)} used of {fmtWeight(total, weightUnit)}</p>
      <p className={isOver ? 'text-brand-crimson' : 'text-brand-neon'}>
        {isOver ? 'Over' : 'Remaining'}: {fmtWeight(remainingAbs, weightUnit)} · {fmtNetBags(remainingAbs / 50)} Net Bags
      </p>
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
      <RecoverySection label="Issuance" entries={recovery.millingEntries} totalBags={recovery.issuedBags} totalKilos={recovery.issuedKilos} weightUnit={weightUnit} columns={ISSUANCE_COLUMNS} />
      <RecoverySection label="Receipt" entries={recovery.transferEntries} totalBags={recovery.recoveredBags} totalKilos={recovery.recoveredKilos} weightUnit={weightUnit} columns={RECEIPT_COLUMNS} />
    </div>
  )
}

export default RicemillRecoveryDetail
