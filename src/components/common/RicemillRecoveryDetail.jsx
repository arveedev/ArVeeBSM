// Shared Issuance (palay in) / Receipt (rice out) breakdown for an NFA
// Ricemill's Regional Authority Number - used identically by
// NfaMillingMonitor.jsx (user-side monitor) and
// RicemillAllocationsPanel.jsx (admin setup panel). Pulled into its own
// file rather than duplicated in both, since this codebase has a
// documented history of exactly that kind of duplication causing
// stale-field bugs once one copy gets fixed and the other doesn't.
//
// Desktop/tablet uses a real <table> with the same Th/Td helpers and
// w-full/border-b row styling as AdminHomeStocks.jsx's Age Grouping
// table - a previous version of this used a fixed-pixel-width CSS grid
// sized to its own content ("w-fit"), which technically aligned its own
// columns correctly but, per direct feedback against a live screenshot,
// looked broken sitting as a narrow island in a sea of empty space on
// a wide desktop window. A real table with w-full fills the available
// width the same natural way Age Grouping's table already does, instead
// of hand-rolling a second, different-looking pattern for tabular data.
// Mobile (below `sm`) still gets its own stacked-row rendering of the
// same entries, since a table this wide genuinely doesn't fit a phone.
//
// Sort/filter (RicemillSortFilterModal) is local state here, not lifted
// to the caller - each expanded Regional Authority Number already gets
// its own mounted instance of this component (NfaMillingMonitor only
// renders it for the one currently-expanded number), so "per authority"
// sort/filter falls out naturally without any extra wiring.

import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { fmtWeight, fmtNetBags } from '../../utils/calculations.js'
import { Th, Td } from '../../pages/AdminHomeShared.jsx'
import RicemillSortFilterModal, { DEFAULT_SORT } from './RicemillSortFilterModal.jsx'

// Issuance has no AI # (there's only ever one AI covering the whole
// allocation - a per-row AI # would have nothing useful to show), so it
// gets its own 3-column table instead of reusing Receipt's 4-column one
// with a blank filler column - that filler used to sit there as a
// visible dead gap between Date and Net Bags. The two sections are
// stacked vertically, never side by side, so there was never a real
// need to keep their columns lined up with each other in the first
// place.
const ISSUANCE_COLUMNS = ['date', 'netBags', 'netKgs']
const RECEIPT_COLUMNS = ['date', 'aiNumber', 'netBags', 'netKgs']

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
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 md:text-sm">
        {label}{varietyName ? ` · ${varietyName}` : ''}
      </p>

      {/* Desktop/tablet: a real table, same pattern as AdminHomeStocks.jsx's
          Age Grouping table - fills the available width instead of
          hugging a fixed narrow size. */}
      {/* Th/Td (shared with Age Grouping) hard-code a small text-xs on
          the cell element itself, which wins over any font-size class
          put on the <table> - a child's own explicit size always beats
          an inherited one. Bumped to a bigger size here via a `text-sm`/
          `text-base` span wrapped around each cell's actual content
          instead of touching Th/Td themselves, so Age Grouping (and any
          other shared consumer) keeps its own original small size. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-neutral-800">
              {columns.map((col) => (
                <Th key={col} right={RIGHT_ALIGNED.has(col)}>
                  <span className="text-sm">{COLUMN_LABEL[col]}</span>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.authId} className="border-b border-neutral-800/50">
                {columns.map((col) => (
                  <Td key={col} right={RIGHT_ALIGNED.has(col)}>
                    <span className={`text-base ${RIGHT_ALIGNED.has(col) ? 'tabular-nums ' : ''}${col === 'netKgs' ? 'font-medium text-app-text' : col === 'date' || col === 'aiNumber' ? 'text-neutral-500' : 'text-neutral-400'}`}>
                      {cellContent(col, entry, weightUnit)}
                    </span>
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-700">
              <Td>
                <span className="text-base font-bold text-app-text">Total</span>
              </Td>
              {leadColSpan > 1 && Array.from({ length: leadColSpan - 1 }).map((_, i) => <Td key={`fill-${i}`} />)}
              <Td right><span className="text-base font-bold tabular-nums text-app-text">{fmtNetBags(totalBags)}</span></Td>
              <Td right><span className="text-base font-bold tabular-nums text-app-text">{fmtWeight(totalKilos, weightUnit)}</span></Td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile: one compact divider-separated row per entry (no nested
          per-row box - a card-inside-a-card read as cluttered) - Date
          (+ AI # underneath, for Receipt) on the left, Net Bags/Net Kgs
          together on one line on the right, instead of a cramped wide
          table. */}
      <div className="divide-y divide-neutral-900 rounded-lg bg-neutral-950 sm:hidden">
        {entries.map((entry) => (
          <div key={entry.authId} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-base tabular-nums text-app-text">{shortDate(entry.date)}</p>
              {columns.includes('aiNumber') && (
                <p className="truncate text-sm tabular-nums text-neutral-500">{entry.aiNumber ?? '—'}</p>
              )}
            </div>
            <p className="shrink-0 text-right text-base tabular-nums">
              <span className="font-medium text-app-text">{fmtNetBags(entry.bags)} bags</span>
              <span className="text-neutral-500"> · {fmtWeight(entry.kilos, weightUnit)}</span>
            </p>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="text-base font-semibold text-app-text">Total</span>
          <p className="text-right text-base tabular-nums">
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
    <div className="text-base tabular-nums text-neutral-500">
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
      {/* Stacked, not side-by-side - the issued/received sentence is
          long enough to wrap on a phone, and a flex row keeps its
          `items-center` cross-axis alignment even after wrapping, which
          left the percentage floating oddly next to a two-line block
          instead of sitting cleanly under it. */}
      <div className="rounded-lg bg-neutral-950 p-3 text-base tabular-nums">
        <p className="text-neutral-500">{fmtWeight(recovery.issuedKilos, weightUnit)} issued → {fmtWeight(recovery.recoveredKilos, weightUnit)} received</p>
        <p className={`mt-1 font-semibold ${recovery.recoveryPct == null ? 'text-neutral-500' : 'text-brand-neon'}`}>
          Recovery: {recovery.recoveryPct == null ? '—' : `${recovery.recoveryPct.toFixed(1)}%`}
        </p>
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
