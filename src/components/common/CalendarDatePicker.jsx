// CalendarDatePicker — a fully custom date picker replacing native
// <input type="date"> for the period pickers. Built because the native
// input has no reliable way to distinguish "user is still navigating
// months" from "user has committed to a date" - any sub-field change
// (including just moving between months) can fire onChange before the
// user has actually picked a day, no matter how the surrounding logic
// tries to compensate for it (debouncing, onBlur, etc. all remained
// unreliable in practice). Here, onChange only ever fires from one
// place: an explicit tap on a specific day cell.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import useDelayedUnmount from '../../hooks/useDelayedUnmount.js'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const pad = (n) => String(n).padStart(2, '0')
const toIso = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`

const parseIso = (iso) => {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return { year: y, month: m - 1, day: d }
}

const fmtDisplay = (iso) => {
  const parsed = parseIso(iso)
  if (!parsed) return ''
  return `${MONTH_NAMES[parsed.month].slice(0, 3)} ${parsed.day}, ${parsed.year}`
}

/**
 * Builds a 6-row calendar grid (42 cells) for the given month, padded
 * with the trailing days of the previous month and leading days of the
 * next month so every week row is complete - standard calendar layout.
 */
const buildMonthGrid = (year, month) => {
  const firstOfMonth = new Date(year, month, 1)
  const startWeekday = firstOfMonth.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const cells = []
  for (let i = 0; i < startWeekday; i++) {
    cells.push({ day: daysInPrevMonth - startWeekday + i + 1, inCurrentMonth: false, monthDelta: -1 })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, inCurrentMonth: true, monthDelta: 0 })
  }
  while (cells.length < 42) {
    cells.push({ day: cells.length - startWeekday - daysInMonth + 1, inCurrentMonth: false, monthDelta: 1 })
  }
  return cells
}

const CalendarDatePicker = forwardRef(function CalendarDatePicker({ value, onChange, placeholder = 'Select date', required = true, label, valueClassName = 'text-sm', nextFieldRef }, ref) {
  const [isOpen, setIsOpen] = useState(false)
  // No exit delay (0, not the slide-out's own 180ms) - this popup is
  // commonly chained (picking a Start Date immediately opens the End
  // Date picker via a ref, in the very same tick). With a delayed
  // unmount, this picker's own backdrop stayed mounted for its exit
  // animation at the same moment the NEXT picker's backdrop mounted for
  // its entrance - two independent `fixed inset-0 bg-black/60` layers
  // stacked briefly doubles the dimming, which read as the whole screen
  // flickering rather than a clean handoff between the two pickers.
  // The slide-out class stays defined for a standalone close (no chained
  // picker opening right after), it just won't get time to play here.
  const shouldRenderPopup = useDelayedUnmount(isOpen, 0)
  const containerRef = useRef(null)
  // The actual calendar popup renders via createPortal(document.body) -
  // it is NOT a DOM descendant of containerRef (which only wraps the
  // trigger button), even though it appears visually attached to it.
  // Outside-click detection needs its own ref for the portaled content
  // specifically - without this, every click inside the calendar
  // itself (month navigation, day cells) was being misclassified as
  // an outside click and closing the picker immediately, before the
  // actual selection could ever register.
  const popupRef = useRef(null)
  const triggerRef = useRef(null)

  useImperativeHandle(ref, () => ({
    open: () => setIsOpen(true),
    focus: (opts) => triggerRef.current?.focus(opts),
  }))

  const selected = parseIso(value)
  const today = new Date()
  const [viewYear, setViewYear] = useState(selected?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(selected?.month ?? today.getMonth())

  // Keyboard day navigation, per explicit request that every input in
  // the app be operable without a mouse: the trigger is already a plain
  // <button> (Space/Enter already open it natively, no extra code
  // needed there). Once open, `focusedIso` tracks which day cell has
  // keyboard focus as a real ISO date rather than a grid index, so it
  // survives crossing a month boundary cleanly - the grid gets rebuilt
  // for the new viewMonth/Year and the matching cell is simply the one
  // whose own computed ISO equals focusedIso, wherever it lands in the
  // new 42-cell layout. Actual DOM focus is moved to match via the ref
  // map effect below, so Enter/Space on the now-focused button reaches
  // its real onClick (handleDayTap) with no separate key handling
  // needed for selection itself - only movement and Escape are custom.
  const [focusedIso, setFocusedIso] = useState(null)
  const dayButtonRefs = useRef(new Map())

  // Keep the calendar's viewed month in sync if the value changes from
  // outside (e.g. a preset button fills this field) while closed.
  useEffect(() => {
    if (isOpen) return
    if (selected) {
      setViewYear(selected.year)
      setViewMonth(selected.month)
    }
  }, [value, isOpen])

  // Close on outside click/touch.
  useEffect(() => {
    if (!isOpen) return
    const handleOutside = (e) => {
      const insideTrigger = containerRef.current && containerRef.current.contains(e.target)
      const insidePopup = popupRef.current && popupRef.current.contains(e.target)
      if (!insideTrigger && !insidePopup) setIsOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [isOpen])

  // Seeds focusedIso the moment the popup opens - the selected date if
  // there is one, otherwise today, so an arrow key immediately after
  // opening moves from a sensible starting point rather than nowhere.
  useEffect(() => {
    if (!isOpen) return
    const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate())
    setFocusedIso(value || todayIso)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Moves real DOM focus onto whichever day button currently matches
  // focusedIso, every time it changes - this is what makes the day grid
  // genuinely keyboard-navigable (arrow keys move focusedIso, this
  // effect follows it with actual focus, and the browser's own
  // Enter/Space-activates-a-focused-button behavior does the rest).
  useEffect(() => {
    if (!isOpen || !focusedIso) return
    dayButtonRefs.current.get(focusedIso)?.focus()
  }, [isOpen, focusedIso, viewMonth, viewYear])

  // Arrow keys move focusedIso by day/week; crossing into the previous
  // or next month re-points viewMonth/viewYear so the target cell is
  // actually rendered before the focus-sync effect above tries to find
  // it. Escape closes without committing anything, matching the same
  // "Esc always cancels" convention as ConfirmDialog.
  const handlePopupKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      triggerRef.current?.focus()
      return
    }
    const deltaDays = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (deltaDays == null || !focusedIso) return
    e.preventDefault()
    const parsed = parseIso(focusedIso)
    const target = new Date(parsed.year, parsed.month, parsed.day + deltaDays)
    if (target.getFullYear() !== viewYear || target.getMonth() !== viewMonth) {
      setViewYear(target.getFullYear())
      setViewMonth(target.getMonth())
    }
    setFocusedIso(toIso(target.getFullYear(), target.getMonth(), target.getDate()))
  }

  const goPrevMonth = () => {
    // Navigating months NEVER touches the selected value - only the
    // calendar's own "currently viewed" month/year.
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1) }
    else setViewMonth((m) => m - 1)
  }
  const goNextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1) }
    else setViewMonth((m) => m + 1)
  }

  const handleDayTap = (cell) => {
    // The ONLY place a date is ever actually committed - an explicit
    // tap on a specific day cell.
    const targetMonth = viewMonth + cell.monthDelta
    const targetDate = new Date(viewYear, targetMonth, cell.day)
    onChange(toIso(targetDate.getFullYear(), targetDate.getMonth(), cell.day))
    setIsOpen(false)
    // Confirmed, reported real bug: closing the popup unmounts the day
    // button that currently holds real DOM focus (via useDelayedUnmount,
    // once its exit animation finishes) - a focused element being
    // removed from the DOM makes the browser drop focus to <body>, with
    // nothing else claiming it, which read as "focus got lost" after
    // picking a date instead of advancing anywhere. `nextFieldRef` lets
    // a caller name where focus should land next (e.g. WSI/ESI's Browse
    // button, so Date -> Browse -> AI picker flows with no dead stop in
    // between); without one, focus returns to this picker's own trigger
    // button - always somewhere real, never dropped to <body>.
    ;(nextFieldRef?.current ?? triggerRef.current)?.focus()
  }

  const cells = buildMonthGrid(viewYear, viewMonth)
  const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate())

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={`flex w-full items-center justify-between rounded-xl border bg-neutral-950 px-3 py-2 text-left text-app-text outline-none transition-all hover:border-brand-neon/50 focus:border-brand-neon ${
          required && !value ? '!border-brand-amber' : 'border-neutral-800'
        }`}
      >
        <span className={`${valueClassName} ${value ? 'text-app-text' : 'text-neutral-500'}`}>
          {value ? fmtDisplay(value) : placeholder}
        </span>
        <Calendar size={16} className="shrink-0 text-neutral-500" />
      </button>

      {shouldRenderPopup && createPortal(
        <div data-suppress-form-shortcuts className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onClick={() => setIsOpen(false)}>
          <div
            ref={popupRef}
            className={`max-h-[90vh] w-72 max-w-full overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-xl ${isOpen ? 'animate-calendar-slide-in' : 'animate-calendar-slide-out'}`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handlePopupKeyDown}
          >
          {label && (
            <div className="mb-2 flex justify-center">
              <p className="animate-label-pulse rounded-full border border-brand-neon/50 bg-brand-neon/10 px-3 py-1 text-center text-sm font-bold uppercase tracking-wide text-brand-neon">
                {label}
              </p>
            </div>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={goPrevMonth}
              aria-label="Previous month"
              className="rounded-lg p-1.5 text-neutral-400 transition-all hover:bg-neutral-800 hover:text-brand-neon active:scale-90"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-semibold text-app-text">{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <button
              type="button"
              onClick={goNextMonth}
              aria-label="Next month"
              className="rounded-lg p-1.5 text-neutral-400 transition-all hover:bg-neutral-800 hover:text-brand-neon active:scale-90"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-neutral-500">
            {WEEKDAY_LABELS.map((w, i) => <div key={i}>{w}</div>)}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((cell, i) => {
              const cellMonth = viewMonth + cell.monthDelta
              const cellDate = new Date(viewYear, cellMonth, cell.day)
              const cellIso = toIso(cellDate.getFullYear(), cellDate.getMonth(), cell.day)
              const isSelected = cellIso === value
              const isToday = cellIso === todayIso

              return (
                <button
                  key={i}
                  ref={(el) => {
                    if (el) dayButtonRefs.current.set(cellIso, el)
                    else dayButtonRefs.current.delete(cellIso)
                  }}
                  type="button"
                  onClick={() => handleDayTap(cell)}
                  onFocus={() => setFocusedIso(cellIso)}
                  // Roving tabindex, same convention already used for
                  // arrow-key toggle groups elsewhere in the app (e.g.
                  // StockFormBase's CONDITION_FLAGS): only the cell arrow
                  // navigation is currently pointed at is a real Tab
                  // stop, so Tab moves past the whole grid in one step
                  // instead of stopping at all 42 day cells.
                  tabIndex={cellIso === focusedIso ? 0 : -1}
                  className={`aspect-square rounded-lg text-xs outline-none transition-all active:scale-90 focus-visible:ring-2 focus-visible:ring-brand-neon ${
                    !cell.inCurrentMonth
                      ? 'text-neutral-700 hover:bg-neutral-800/50'
                      : isSelected
                        ? 'bg-brand-neon font-bold text-brand-contrast'
                        : isToday
                          ? 'border border-brand-neon/50 text-brand-neon'
                          : 'text-app-text hover:bg-neutral-800'
                  }`}
                >
                  {cell.day}
                </button>
              )
            })}
          </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
})

export default CalendarDatePicker
