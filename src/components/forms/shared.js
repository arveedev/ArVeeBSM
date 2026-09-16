// Shared styling constants for transaction forms (WSR/WSI/WTS/ESR/ESI).

import { useEffect, useState } from 'react'

// Real bug found, twice over, reported directly with real screenshots:
// (1) grid-auto-flow: column with a measured row count shared row
// HEIGHT across both columns - whenever one column's group (e.g. Stock
// Details, several paired fields) was naturally taller than its row
// partner (e.g. Document, just two single fields), the shorter group
// left a dead empty gap below it before the next row started, reading
// as broken/misaligned rather than "grouped." (2) the whole two-column
// layout was gated on isTouchDevicePointer() (pointer: coarse) - a
// mouse-driven PC with a genuinely narrow/resized window still got the
// cramped two-column layout meant for a wide screen, and a touchscreen
// device at a wide width would have stayed single-column. Per explicit
// correction, this must respond to actual SCREEN SIZE, not input
// device type. Replaced with useIsWideLayout (a live matchMedia
// listener, not a one-time check) driving a plain two-column FLEX split
// instead of a shared-row grid - each column just stacks its own two
// groups tightly with its own natural height (no forced row-height
// matching, so no more dead gaps), and the field-group components pass
// the four groups in explicitly chosen visual order rather than relying
// on any DOM-order/row-count trick.
const WIDE_LAYOUT_BREAKPOINT_PX = 1024

export const useIsWideLayout = () => {
  const [isWide, setIsWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(`(min-width: ${WIDE_LAYOUT_BREAKPOINT_PX}px)`).matches
  )
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${WIDE_LAYOUT_BREAKPOINT_PX}px)`)
    const handleChange = (e) => setIsWide(e.matches)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])
  return isWide
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

// Grouping-box redesign (per explicit request, several rounds of demo
// review): one flat tinted box per REAL semantic group of fields (e.g.
// "Document", "Customer", "Stock Details", "Quantity" - grouped by
// relevance, not by arbitrary DOM position), no title text on any of
// them - the same tint on every group, not alternating. Shared across
// StockFormBase/SackFormBase/WTSForm so the four already-tuned values
// (tint strength, radius, padding, internal gap) never drift apart
// between the three forms.
export const groupBoxClass = 'rounded-xl bg-white/[0.035] p-4 space-y-3'

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
    // Real bug found, reported directly: this used to re-center EVERY
    // focused field unconditionally, so tabbing/clicking between fields
    // that were already comfortably on screen still triggered a fresh
    // smooth-scroll each time - each one interrupting whatever the
    // previous one was still doing, which read as a jittery shake
    // rather than a deliberate scroll. Only actually scroll when the
    // field isn't already reasonably visible (a comfortable margin from
    // each edge, not just barely-clipped) - a field already in view now
    // simply keeps focus with no scroll at all, and only a field that's
    // genuinely off-screen (or hard up against an edge, e.g. under a
    // fixed header/keyboard) still gets the original center-scroll.
    const rect = el.getBoundingClientRect()
    const margin = 80
    // visualViewport.height, not window.innerHeight, for the bottom
    // bound - real regression, reported directly ("no more auto-focus
    // on the entry forms"): on a phone, opening the on-screen keyboard
    // shrinks the VISUAL viewport but window.innerHeight commonly stays
    // the LAYOUT viewport's full height in most mobile browsers, so this
    // check was reading a field as "comfortably visible" (against the
    // full, keyboard-ignoring height) and skipping the scroll exactly
    // when the keyboard was actually covering it - the tapped field
    // never came into view, reading as focus not working at all.
    // visualViewport is undefined on desktop/older browsers, where
    // innerHeight is already correct and this falls back to it.
    const viewportH = window.visualViewport?.height ?? window.innerHeight
    const comfortablyVisible = rect.top >= margin && rect.bottom <= viewportH - margin
    if (comfortablyVisible) return
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
