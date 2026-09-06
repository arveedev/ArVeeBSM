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
// than another's. That grid stays desktop/tablet-only (`sm:` and up) -
// on a real narrow phone its four fixed-width tracks don't fit the
// screen and forced a sideways scroll just to read Net Kgs, so mobile
// gets its own stacked-card rendering of the same entries instead.
//
// Sort/filter (RicemillSortFilterModal) is local state here, not lifted
// to the caller - each expanded Regional Authority Number already gets
// its own mounted instance of this component (NfaMillingMonitor only
// renders it for the one currently-expanded number), so "per authority"
// sort/filter falls out naturally without any extra wiring.

import { Fragment, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { fmtWeight, fmtNetBags } from '../../utils/calculations.js'
import RicemillSortFilterModal, { DEFAULT_SORT } from './RicemillSortFilterModal.jsx'

// Issuance has no AI # (there's only ever one AI covering the whole
// allocation - a per-row AI # would have nothing useful to show), so it
// gets its own 3-track grid instead of reusing Receipt's 4-track one
// with a blank filler column - that filler used to sit there as a big
// dead gap between Date and Net Bags with nothing in it, which looked
// broken rather than aligned. The two sections are stacked vertically,
// never side by side, so there was never a real need to keep their
// columns lined up with each other in the first place.
const ISSUANCE_COLUMNS = ['date', 'netBags', 'netKgs']
const RECEIPT_COLUMNS = ['date', 'aiNumber', 'netBags', 'netKgs']

// Tailwind's build-time scanner only picks up class names it can see as
// a literal string - a runtime-concatenated `grid-cols-[${...}]` would
// never make it into the generated CSS at all, so these stay static
// strings, keyed by column count, rather than assembled from a
// per-column width map at render time. No `1fr` track - a flexible
// track stretched to fill whatever width its parent gave it, which on
// a wide desktop screen was most of the page, leaving huge empty gaps
// between columns. Every track is a fixed width sized to its real
// content, and the grid itself is `w-fit` (see below) so the whole
// table stops stretching wider than it needs to be. Net Kgs gets the
// widest track of the four - "5,000.000 kg" is the longest realistic
// value here and needs the room, paired with `whitespace-nowrap` on
// every cell below so a value can never wrap onto a second line no
// matter how a track's width compares to its content.
const GRID_COLS_BY_COUNT = {
  3: 'grid-cols-[92px_92px_128px] md:grid-cols-[110px_110px_152px]',
  4: 'grid-cols-[92px_92px_76px_128px] md:grid-cols-[110px_110px_96px_152px]',
}

const COLUMN_LABEL = { date: 'Date', aiNumber: 'AI #', netBags: 'Net Bags', netKgs: 'Net Kgs' }
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

/** Sorts and date-range-filters one entries list per the modal's
 * current settings. Kept generic across Issuance/Receipt - both share
 * the same entry shape (date, bags, kilos, plus optional aiNumber). */
function applySortFilter(entries, { sortBy, dateFrom, dateTo }) {
  const filtered = entries.filter((e) => {
    if (dateFrom && (e.date ?? '') < dateFrom) return false
    if (dateTo && (e.date ?? '') > dateTo) return false
    return true
  })
  return [...filtered].sort((a, b) => {
    if (sortBy === 'date-asc') return (a.date ?? '').localeCompare(b.date ?? '')
    if (sortBy === 'kilos-desc') return (b.kilos ?? 0) - (a.kilos ?? 0)
    if (sortBy === 'kilos-asc') return (a.kilos ?? 0) - (b.kilos ?? 0)
    return (b.date ?? '').localeCompare(a.date ?? '') // date-desc, the default
  })
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

// Total is always the sum of whatever entries are actually being shown
// (computed here, not passed in) - that way it stays correct whether
// the list is the full unfiltered set or has been narrowed down by the
// sort/filter modal above, with no separate total to keep in sync.
function RecoverySection({ label, entries, weightUnit, columns }) {
  if (entries.length === 0) return null
  const totalBags = entries.reduce((s, e) => s + (e.bags ?? 0), 0)
  const totalKilos = entries.reduce((s, e) => s + (e.kilos ?? 0), 0)
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

      {/* Desktop/tablet: the original aligned grid, unchanged. */}
      <div className="hidden overflow-x-auto rounded-lg bg-neutral-950 p-2 sm:block md:p-3">
        <div className={`grid ${GRID_COLS_BY_COUNT[columns.length]} gap-x-3 gap-y-2 text-sm leading-tight md:text-base`}>
          {columns.map((col, idx) => (
            <span key={`h-${col}-${idx}`} className={`whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-neutral-600 md:text-sm ${RIGHT_ALIGNED.has(col) ? 'text-right' : ''}`}>
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
                      ? `whitespace-nowrap text-right tabular-nums ${col === 'netKgs' ? 'font-medium text-app-text' : 'text-neutral-400'}`
                      : 'whitespace-nowrap text-neutral-500'
                  }
                >
                  {cellContent(col, entry, weightUnit)}
                </span>
              ))}
            </Fragment>
          ))}
          <span className="whitespace-nowrap border-t border-neutral-800 pt-1 font-semibold text-app-text" style={{ gridColumn: `span ${leadColSpan}` }}>Total</span>
          <span className="whitespace-nowrap border-t border-neutral-800 pt-1 text-right font-semibold tabular-nums text-app-text">{fmtNetBags(totalBags)}</span>
          <span className="whitespace-nowrap border-t border-neutral-800 pt-1 text-right font-semibold tabular-nums text-app-text">{fmtWeight(totalKilos, weightUnit)}</span>
        </div>
      </div>

      {/* Mobile: one compact divider-separated row per entry (no nested
          per-row box - a card-inside-a-card read as cluttered) - Date
          (+ AI # underneath, for Receipt) on the left, Net Bags/Net Kgs
          together on one line on the right, instead of a cramped wide
          table. */}
      <div className="divide-y divide-neutral-900 rounded-lg bg-neutral-950 sm:hidden">
        {entries.map((entry) => (
          <div key={entry.authId} className="flex items-center justify-between gap-3 px-2.5 py-2">
            <div className="min-w-0">
              <p className="text-sm text-app-text">{shortDate(entry.date)}</p>
              {columns.includes('aiNumber') && (
                <p className="truncate text-xs text-neutral-500">{entry.aiNumber ?? '—'}</p>
              )}
            </div>
            <p className="shrink-0 text-right text-sm tabular-nums">
              <span className="font-medium text-app-text">{fmtNetBags(entry.bags)} bags</span>
              <span className="text-neutral-500"> · {fmtWeight(entry.kilos, weightUnit)}</span>
            </p>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 px-2.5 py-2">
          <span className="text-sm font-semibold text-app-text">Total</span>
          <p className="text-right text-sm tabular-nums">
            <span className="font-semibold text-app-text">{fmtNetBags(totalBags)} bags</span>
            <span className="text-neutral-400"> · {fmtWeight(totalKilos, weightUnit)}</span>
          </p>
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
  const [modalOpen, setModalOpen] = useState(false)
  const [sortBy, setSortBy] = useState(DEFAULT_SORT)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const isFiltered = sortBy !== DEFAULT_SORT || Boolean(dateFrom) || Boolean(dateTo)

  if (!recovery) {
    return <p className="text-sm text-neutral-500 md:text-base">No Issuance (palay in) or Receipt (rice out) activity recorded yet for this Regional Authority Number.</p>
  }

  const sortFilter = { sortBy, dateFrom, dateTo }
  const millingEntries = applySortFilter(recovery.millingEntries, sortFilter)
  const transferEntries = applySortFilter(recovery.transferEntries, sortFilter)

  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-neutral-950 p-2 text-sm md:p-3 md:text-base">
        <div className="flex items-center justify-between gap-2">
          <span className="text-neutral-500">{fmtWeight(recovery.issuedKilos, weightUnit)} issued → {fmtWeight(recovery.recoveredKilos, weightUnit)} received</span>
          <span className={`font-semibold ${recovery.recoveryPct == null ? 'text-neutral-500' : 'text-brand-neon'}`}>
            {recovery.recoveryPct == null ? '—' : `${recovery.recoveryPct.toFixed(1)}%`}
          </span>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all active:scale-95 ${
            isFiltered
              ? 'border-brand-neon bg-brand-neon/10 text-brand-neon'
              : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-brand-neon/50 hover:text-brand-neon'
          }`}
        >
          <SlidersHorizontal size={13} />
          Sort &amp; Filter{isFiltered ? ' (active)' : ''}
        </button>
      </div>

      <RecoverySection label="Issuance" entries={millingEntries} weightUnit={weightUnit} columns={ISSUANCE_COLUMNS} />
      <RecoverySection label="Receipt" entries={transferEntries} weightUnit={weightUnit} columns={RECEIPT_COLUMNS} />
      {millingEntries.length === 0 && transferEntries.length === 0 && (
        <p className="text-sm text-neutral-500 md:text-base">No entries match this date range.</p>
      )}

      {modalOpen && (
        <RicemillSortFilterModal
          sortBy={sortBy}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={({ sortBy: nextSort, dateFrom: nextFrom, dateTo: nextTo }) => {
            setSortBy(nextSort)
            setDateFrom(nextFrom)
            setDateTo(nextTo)
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}

export default RicemillRecoveryDetail
