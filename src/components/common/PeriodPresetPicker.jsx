// PeriodPresetPicker — month navigation + quick-pick reporting-period
// buttons (1-7, 8-15, 16-22, 23-end of month), shared across every
// date-range picker in the app (Piles, Reports' two date pairs) rather
// than duplicating the same UI and logic in each place.

import { useState } from 'react'
import { getPeriodPresetRanges, getDefaultPresetMonthOffset } from '../../utils/calculations.js'

// The "first few days of a new month -> show the previous month"
// heuristic (getDefaultPresetMonthOffset) only makes sense when there's
// no real selection yet to go by (e.g. Stock Statement's period starts
// genuinely blank). When a currentFrom is already set - e.g. Summary's
// own period defaults straight to today - the month nav must match
// THAT, not run its own separate guess: on Sep 3, Summary's own From/To
// already default to Sep 3, but the heuristic alone would still open on
// August, a real, confirmed mismatch where the header/quick-pick
// buttons showed a different month than the actual active selection.
const monthOffsetFor = (currentFrom) => {
  if (!currentFrom) return getDefaultPresetMonthOffset()
  const [y, m] = currentFrom.split('-').map(Number)
  if (!y || !m) return getDefaultPresetMonthOffset()
  const now = new Date()
  return (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth())
}

function PeriodPresetPicker({ onSelectRange, currentFrom, currentTo }) {
  const [monthOffset, setMonthOffset] = useState(() => monthOffsetFor(currentFrom))
  const [monthNavDirection, setMonthNavDirection] = useState(null)
  const { monthLabel, ranges } = getPeriodPresetRanges(monthOffset)

  // Which preset (if any) matches the actual current selection - null
  // when the user has picked a custom date/range that doesn't match
  // any preset (e.g. via the calendar picker directly), correctly
  // showing no pill at all in that case rather than a stale one.
  const activeIndex = ranges.findIndex((preset) => preset.from === currentFrom && preset.to === currentTo)

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => { setMonthNavDirection('back'); setMonthOffset((m) => m - 1) }}
          aria-label="Previous month"
          className="rounded-lg border border-neutral-800 bg-neutral-900 px-8 py-2 text-lg text-neutral-400 transition-all hover:border-brand-neon/50 hover:text-brand-neon active:scale-95"
        >
          ‹
        </button>
        <span
          key={monthOffset}
          className={`text-base font-semibold text-app-text ${monthNavDirection === 'back' ? 'animate-nav-back' : monthNavDirection === 'forward' ? 'animate-nav-forward' : ''}`}
        >
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => { setMonthNavDirection('forward'); setMonthOffset((m) => m + 1) }}
          aria-label="Next month"
          className="rounded-lg border border-neutral-800 bg-neutral-900 px-8 py-2 text-lg text-neutral-400 transition-all hover:border-brand-neon/50 hover:text-brand-neon active:scale-95"
        >
          ›
        </button>
      </div>
      <div className="relative mt-2 flex gap-2">
        {activeIndex !== -1 && (
          <div
            className="pointer-events-none absolute inset-y-0 z-0 rounded-lg border border-brand-neon/50 bg-brand-neon/10 transition-transform duration-300 ease-out"
            style={{
              width: `calc((100% - ${(ranges.length - 1) * 0.5}rem) / ${ranges.length})`,
              transform: `translateX(calc(${activeIndex} * (100% + 0.5rem)))`,
            }}
          />
        )}
        {ranges.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onSelectRange(preset.from, preset.to)}
            className="relative z-10 flex-1 rounded-lg border border-transparent py-1.5 text-sm font-medium text-neutral-400 transition-colors hover:text-brand-neon active:scale-95"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default PeriodPresetPicker
