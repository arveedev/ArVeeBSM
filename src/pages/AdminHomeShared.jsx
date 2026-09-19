// Shared table helpers for AdminHomeStocks.jsx and AdminHomeSacks.jsx.

import { Inbox } from 'lucide-react'

export function Section({ title, headerRight, children }) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-300">{title}</h2>
        {headerRight}
      </div>
      <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        {children}
      </div>
    </div>
  )
}

export function Th({ children, right }) {
  return (
    <th className={`whitespace-nowrap px-2 pb-2 text-xs font-semibold uppercase text-neutral-500 first:pl-0 last:pr-0 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

export function Td({ children, right }) {
  return (
    <td className={`whitespace-nowrap px-2 py-1.5 text-xs text-neutral-300 first:pl-0 last:pr-0 ${right ? 'text-right' : ''}`}>
      {children}
    </td>
  )
}

export function Empty() {
  return (
    <div className="flex flex-col items-center gap-2 py-3 animate-empty-state-in">
      <Inbox size={18} className="text-neutral-600" />
      <p className="text-xs text-neutral-500">No data available yet.</p>
    </div>
  )
}

// Distinct from Empty above on purpose - a branch-wide figure that's
// still being computed (warehouseCategoryStock's batched per-warehouse
// pass, AdminHomeStocks.jsx) looked IDENTICAL to one that's genuinely
// zero, which is exactly what made the real reported bug (iOS PWA:
// stock computation silently returning incomplete data) so hard to
// pin down - the screen matched "no data" either way. This gives the
// still-loading case its own visual state so a real zero and "still
// working on it" are never confused again.
export function LoadingRows() {
  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-700 border-t-brand-neon" />
      <p className="text-xs text-neutral-500">Computing branch totals…</p>
    </div>
  )
}
