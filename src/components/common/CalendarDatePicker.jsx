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

const CalendarDatePicker = forwardRef(function CalendarDatePicker({ value, onChange, placeholder = 'Select date', required = true, label }, ref) {
  const [isOpen, setIsOpen] = useState(false)
  const shouldRenderPopup = useDelayedUnmount(isOpen, 180)
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

  useImperativeHandle(ref, () => ({
    open: () => setIsOpen(true),
  }))

  const selected = parseIso(value)
  const today = new Date()
  const [viewYear, setViewYear] = useState(selected?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(selected?.month ?? today.getMonth())

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
  }

  const cells = buildMonthGrid(viewYear, viewMonth)
  const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate())

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={`flex w-full items-center justify-between rounded-xl border bg-neutral-950 px-3 py-2 text-left text-sm text-app-text outline-none transition-all hover:border-brand-neon/50 focus:border-brand-neon ${
          required && !value ? '!border-brand-amber' : 'border-neutral-800'
        }`}
      >
        <span className={value ? 'text-app-text' : 'text-neutral-500'}>
          {value ? fmtDisplay(value) : placeholder}
        </span>
        <Calendar size={16} className="shrink-0 text-neutral-500" />
      </button>

      {shouldRenderPopup && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onClick={() => setIsOpen(false)}>
          <div
            ref={popupRef}
            className={`max-h-[90vh] w-72 max-w-full overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-xl ${isOpen ? 'animate-pop-in' : 'animate-pop-out'}`}
            onClick={(e) => e.stopPropagation()}
          >
          {label && <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-brand-neon">{label}</p>}
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
                  type="button"
                  onClick={() => handleDayTap(cell)}
                  className={`aspect-square rounded-lg text-xs transition-all active:scale-90 ${
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
