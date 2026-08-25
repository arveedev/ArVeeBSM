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

import { Fragment } from 'react'
import { fmtWeight, fmtNetBags } from '../../utils/calculations.js'

// Issuance has no AI # (there's only ever one AI covering the whole
// allocation - a per-row AI # would have nothing useful to show) and no
// Variety column (every row is the same static "derived from mill
// capacity" placeholder, not a real per-row value worth its own
// column). Receipt keeps both - each row is its own real, distinct AI
// and variety.
//
// Both sections still use the SAME 5-track grid (with Issuance's unused
// AI#/Variety tracks rendered as empty, unlabeled spacers) rather than a
// narrower 3-column grid of its own - two side-by-side tables with
// different column counts don't read as a matched pair; Net Bags and
// Net Kgs need to land in the same horizontal position in both.
const ISSUANCE_COLUMNS = ['date', 'blank', 'blank', 'netBags', 'netKgs']
const RECEIPT_COLUMNS = ['date', 'aiNumber', 'variety', 'netBags', 'netKgs']

// Tailwind's build-time scanner only picks up class names it can see as
// a literal string - a runtime-concatenated `grid-cols-[${...}]` would
// never make it into the generated CSS at all, so this stays a single
// static string (both sections are always 5 tracks now) rather than
// assembled from a per-column width map at render time.
const GRID_COLS = 'grid-cols-[64px_84px_1fr_72px_96px] md:grid-cols-[84px_112px_1fr_96px_136px]'

const COLUMN_LABEL = { date: 'Date', aiNumber: 'AI #', variety: 'Variety', netBags: 'Net Bags', netKgs: 'Net Kgs', blank: '' }
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
  const leadColSpan = columns.length - 2 // every column except Net Bags/Net Kgs, for the "Total" label
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 md:text-sm">{label}</p>
      <div className="overflow-x-auto rounded-lg bg-neutral-950 p-2 md:p-3">
        <div className={`grid ${GRID_COLS} gap-x-3 gap-y-2 text-sm leading-tight md:text-base`}>
          {columns.map((col, idx) => (
            <span key={`h-${col}-${idx}`} className={`text-xs font-semibold uppercase tracking-wide text-neutral-600 md:text-sm ${RIGHT_ALIGNED.has(col) ? 'text-right' : ''}`}>
              {COLUMN_LABEL[col]}
            </span>
          ))}
          {entries.map((entry) => (
            <Fragment key={entry.authId}>
              {columns.map((col, idx) => (
                <span
                  key={`${col}-${idx}`}
                  className={
                    RIGHT_ALIGNED.has(col)
                      ? `text-right tabular-nums ${col === 'netKgs' ? 'font-medium text-app-text' : 'text-neutral-400'}`
                      : `truncate ${col === 'variety' ? 'text-app-text' : 'text-neutral-500'}`
                  }
                >
                  {cellContent(col, entry, weightUnit)}
                </span>
              ))}
            </Fragment>
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
    <div className="text-sm text-neutral-500 md:text-base">
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
    return <p className="text-sm text-neutral-500 md:text-base">No Issuance (palay in) or Receipt (rice out) activity recorded yet for this Regional Authority Number.</p>
  }
  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-neutral-950 p-2 text-sm md:p-3 md:text-base">
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
