// PeriodPresetPicker — month navigation + quick-pick reporting-period
// buttons (1-7, 8-16, 16-22, 23-end of month), shared across every
// date-range picker in the app (Piles, Reports' two date pairs) rather
// than duplicating the same UI and logic in each place.

import { useState } from 'react'
import { getPeriodPresetRanges, getDefaultPresetMonthOffset } from '../../utils/calculations.js'

function PeriodPresetPicker({ onSelectRange }) {
  const [monthOffset, setMonthOffset] = useState(getDefaultPresetMonthOffset)
  const { monthLabel, ranges } = getPeriodPresetRanges(monthOffset)

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonthOffset((m) => m - 1)}
          aria-label="Previous month"
          className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-400 transition-all hover:border-brand-neon/50 hover:text-brand-neon active:scale-95"
        >
          ‹
        </button>
        <span className="text-xs font-medium text-neutral-400">{monthLabel}</span>
        <button
          type="button"
          onClick={() => setMonthOffset((m) => m + 1)}
          aria-label="Next month"
          className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-400 transition-all hover:border-brand-neon/50 hover:text-brand-neon active:scale-95"
        >
          ›
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        {ranges.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onSelectRange(preset.from, preset.to)}
            className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 py-1.5 text-xs font-medium text-neutral-400 transition-all hover:border-brand-neon/50 hover:text-brand-neon active:scale-95"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default PeriodPresetPicker
