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
// allocation - a per-row AI # would have nothing useful to show).
// Neither section gives Variety its own column any more - within one
// Regional Authority Number every Receipt row is always the same
// variety, so it's shown once, next to the "Receipt" label itself,
// rather than repeated identically down an entire column.
//
// Both sections still use the SAME 4-track grid (Issuance's unused AI#
// track rendered as an empty, unlabeled spacer) rather than a narrower
// grid of its own - two side-by-side tables with different column
// counts don't read as a matched pair; Net Bags and Net Kgs need to
// land in the same horizontal position in both.
const ISSUANCE_COLUMNS = ['date', 'blank', 'netBags', 'netKgs']
const RECEIPT_COLUMNS = ['date', 'aiNumber', 'netBags', 'netKgs']

// Tailwind's build-time scanner only picks up class names it can see as
// a literal string - a runtime-concatenated `grid-cols-[${...}]` would
// never make it into the generated CSS at all, so this stays a single
// static string (both sections are always 4 tracks now) rather than
// assembled from a per-column width map at render time. No `1fr` track -
// a flexible track stretched to fill whatever width its parent gave it,
// which on a wide desktop screen was most of the page, leaving a huge
// empty gap between Date and Net Bags. Every track is now a fixed width
// sized to its real content, and the grid itself is `w-fit` (see below)
// so the whole table stops stretching wider than it needs to be.
const GRID_COLS = 'grid-cols-[92px_92px_76px_104px] md:grid-cols-[110px_110px_96px_128px]'

const COLUMN_LABEL = { date: 'Date', aiNumber: 'AI #', netBags: 'Net Bags', netKgs: 'Net Kgs', blank: '' }
const RIGHT_ALIGNED = new Set(['netBags', 'netKgs'])

/** "2026-07-31" -> "Jul 31" - a short, unambiguous form that never needs
 * truncating regardless of column width or font size, unlike the raw
 * digit form it replaces (which could still overflow a narrow column
 * once the text itself got bigger). */
function shortDate(isoDate) {
  if (!isoDate) return '—'
  const s = String(isoDate)
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!match) return s
  const [, , month, day] = match
  const monthName = new Date(2000, Number(month) - 1, 1).toLocaleString('en-US', { month: 'short' })
  return `${monthName} ${Number(day)}`
}

function cellContent(column, entry, weightUnit) {
  switch (column) {
    case 'date': return shortDate(entry.date)
    case 'aiNumber': return entry.aiNumber ?? '—'
    case 'netBags': return fmtNetBags(entry.bags)
    case 'netKgs': return fmtWeight(entry.kilos, weightUnit)
    default: return ''
  }
}

function RecoverySection({ label, entries, totalBags, totalKilos, weightUnit, columns }) {
  if (entries.length === 0) return null
  const leadColSpan = columns.length - 2 // every column except Net Bags/Net Kgs, for the "Total" label
  // Every entry within one Regional Authority Number's Receipt list is
  // always the same variety - shown once here instead of repeated down
  // its own column. Issuance has no real per-row variety (every entry
  // is the same "Mill capacity" placeholder - see NfaMillingMonitor.jsx)
  // so this only ever applies to Receipt, gated on its AI # column.
  const varietyName = columns.includes('aiNumber') ? entries.find((e) => e.varietyName)?.varietyName : null
  return (
    <div className="w-fit max-w-full">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 md:text-sm">
        {label}{varietyName ? ` · ${varietyName}` : ''}
      </p>
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
                      : 'whitespace-nowrap text-neutral-500'
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
  // Clamped to [0, 100] so an over-used allocation's bar still reads
  // as a full track rather than overflowing it - the "Over" line right
  // below already carries the actual overage amount.
  const usedPercent = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0
  const barFillClass = isOver ? 'bg-brand-crimson' : usedPercent >= 100 ? 'bg-brand-neon' : 'bg-brand-neon/60'
  return (
    <div className="text-sm text-neutral-500 md:text-base">
      <p>{fmtWeight(used, weightUnit)} used of {fmtWeight(total, weightUnit)}</p>
      <p className={isOver ? 'text-brand-crimson' : 'text-brand-neon'}>
        {isOver ? 'Over' : 'Remaining'}: {fmtWeight(remainingAbs, weightUnit)} · {fmtNetBags(remainingAbs / 50)} Net Bags
      </p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div className={`h-full rounded-full transition-all ${barFillClass}`} style={{ width: `${usedPercent}%` }} />
      </div>
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
