// Shared styling constants for transaction forms (WSR/WSI/WTS/ESR/ESI).

import { useLayoutEffect, useRef, useState } from 'react'

// PC field-group layout: real CSS Grid with grid-auto-flow: column, so
// groups fill straight DOWN the left column first, then the right one
// (raster reading/tab order 1,3,2,4... for 4 groups) - per explicit
// request, NOT left-to-right row-major (1,2 / 3,4), and NOT CSS
// multi-column's height-balanced flow either (the earlier, rejected
// attempt - it could split a tall group's content across the column
// break and gave no real row alignment between columns). grid-auto-flow:
// column only distributes into the SECOND column once the declared row
// count is exhausted - it needs a real row count up front, which this
// form's deeply-conditional field list doesn't track anywhere as an
// array. Rather than restructure ~700 lines of existing conditional
// JSX into an array just to get a .length, this counts the container's
// actual rendered children after each paint (cheap - just a DOM
// children.length read) and feeds that back as the grid's row count,
// so the split always matches whatever's really showing right now.
export const useFieldGroupRowCount = (enabled) => {
  const ref = useRef(null)
  const [rowCount, setRowCount] = useState(1)
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return
    const count = Math.max(1, Math.ceil(ref.current.children.length / 2))
    if (count !== rowCount) setRowCount(count)
  })
  return [ref, rowCount]
}

// A subtle vertical rule down the middle of the PC two-column field
// grid, per explicit request - independent of the grid's own column
// track (which has no visual line of its own), so it stays centered
// regardless of how uneven the two columns' real content heights are.
export const columnDividerStyle = {
  backgroundImage:
    'linear-gradient(to right, transparent calc(50% - 0.5px), rgba(255,255,255,0.08) calc(50% - 0.5px), rgba(255,255,255,0.08) calc(50% + 0.5px), transparent calc(50% + 0.5px))',
}

// focus:shadow adds a real glow ring around whichever field currently
// has focus - per explicit request ("every press of tab must go to the
// next input box or selector, with a glow where the focus is"). Applies
// to every input/select built on this class across the entry forms.
export const inputClass =
  'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-app-text outline-none transition-colors focus:border-brand-neon focus:shadow-[0_0_0_3px_rgba(0,255,163,0.25)]'

export const labelClass = 'text-sm font-medium text-neutral-300'

export const readOnlyClass =
  'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-app-text'

export const primaryButtonClass =
  'flex-1 rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 hover:shadow-[0_0_16px_rgba(0,255,163,0.45)] active:scale-95 disabled:opacity-50 disabled:pointer-events-none'

export const secondaryButtonClass =
  'flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-3 text-sm font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-95 disabled:opacity-50 disabled:pointer-events-none'

export const smallButtonClass =
  'rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-95'

export const removeButtonClass =
  'rounded-lg border border-neutral-800 px-2 py-1.5 text-neutral-400 transition-all hover:border-brand-crimson/50 hover:text-brand-crimson active:scale-90'

// Stock condition flags — GQ (Good Quality), TRD (Trace Damage), INF
// (Infested), PD (Part Damaged), TD (Totally Damaged).
export const CONDITION_FLAGS = ['GQ', 'TRD', 'INF', 'PD', 'TD']

// Per explicit request: "when there is a shift of focus the app must
// move it to the center". Attach once to each form's own scroll
// container ref - a bubbled 'focusin' fires on every real Tab/click
// focus change (native inputs/selects/buttons only; a mousedown-only
// interaction like a checkbox tap doesn't need this). Shared here
// rather than tripled across StockFormBase/SackFormBase/WTSForm since
// the logic itself is identical, not form-specific.
export const attachCenterFocusScroll = (containerEl) => {
  if (!containerEl) return () => {}
  const handleFocusIn = (e) => {
    const el = e.target
    if (!(el instanceof HTMLElement)) return
    if (!['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  containerEl.addEventListener('focusin', handleFocusIn)
  return () => containerEl.removeEventListener('focusin', handleFocusIn)
}

// Per explicit request: on a blocked Save (missing required field) or a
// failed validateForm() check, focus (and center-scroll to) the actual
// offending field instead of just showing a toast. Every required
// field already gets a `!border-brand-amber` class the moment it's
// empty/invalid (the existing app-wide convention) - reused here rather
// than threading a ref through every individual field, which would mean
// touching nearly every required field in three already very large,
// deeply-conditional forms. Finds the first amber-bordered field that's
// actually still visible (an amber class can exist on a field hidden by
// a cereal-tab/type conditional not currently rendered at all - those
// simply aren't in the DOM, so this only ever finds real, currently-
// showing offenders) within the given container, in DOM (reading) order.
export const focusFirstInvalidField = (containerEl) => {
  if (!containerEl) return false
  const candidates = containerEl.querySelectorAll('input, select, textarea')
  for (const el of candidates) {
    if (el.className && String(el.className).includes('border-brand-amber')) {
      el.focus({ preventScroll: true })
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return true
    }
  }
  return false
}
