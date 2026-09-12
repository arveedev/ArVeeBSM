// Custom renderer for every react-hot-toast notification in the app -
// replaces the default plain box with a colored/iconed card matching
// the toast's own type (success/error/loading/blank), each icon playing
// its own distinct entrance motion instead of one shared generic pop.
// No call site (toast.success(...), toast.error(...), etc.) needs to
// change - this hooks in once, globally, via <Toaster>'s children
// render-prop in App.jsx.
//
// Swipe-to-dismiss: drag the card left or right past a threshold to
// dismiss it early. Stacking multiple toasts at once is already
// react-hot-toast's own default behavior, nothing extra needed for that.

import { useEffect, useRef, useState } from 'react'
import { toast as hotToast, resolveValue } from 'react-hot-toast'
import { CheckCircle2, AlertTriangle, Loader2, Info } from 'lucide-react'

const TYPE_STYLES = {
  success: { Icon: CheckCircle2, color: '#00FFA3', motion: 'animate-toast-icon-check' },
  error: { Icon: AlertTriangle, color: '#EF4444', motion: 'animate-toast-icon-shake' },
  loading: { Icon: Loader2, color: '#378ADD', motion: 'animate-toast-icon-spin' },
  blank: { Icon: Info, color: '#378ADD', motion: 'animate-toast-icon-nod' },
}

const SWIPE_DISMISS_PX = 80

function AnimatedToast({ t }) {
  const cfg = TYPE_STYLES[t.type] ?? TYPE_STYLES.blank
  const { Icon, color, motion } = cfg
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef(null)

  const handlePointerDown = (e) => {
    startXRef.current = e.clientX
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e) => {
    if (startXRef.current == null) return
    setDragX(e.clientX - startXRef.current)
  }
  const handlePointerUp = () => {
    if (startXRef.current == null) return
    if (Math.abs(dragX) > SWIPE_DISMISS_PX) {
      hotToast.dismiss(t.id)
    } else {
      setDragX(0)
    }
    setDragging(false)
    startXRef.current = null
  }

  const entranceStyle = t.visible
    ? 'animate-toast-pop-in'
    : 'animate-toast-pop-out'

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`flex items-center gap-2.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3.5 py-2.5 shadow-lg ${t.visible ? entranceStyle : entranceStyle}`}
      style={{
        borderLeft: `3px solid ${color}`,
        transform: `translateX(${dragX}px)`,
        opacity: dragging ? Math.max(0.2, 1 - Math.abs(dragX) / 200) : 1,
        transition: dragging ? 'none' : 'transform 0.25s ease, opacity 0.25s ease',
        touchAction: 'pan-y',
        cursor: 'grab',
      }}
    >
      <span className="relative flex shrink-0" style={{ color }}>
        {t.type !== 'loading' && (
          <span
            className="absolute inset-0 rounded-full animate-toast-icon-ring"
            style={{ boxShadow: `0 0 0 0 ${color}` }}
          />
        )}
        <Icon size={20} className={t.type === 'loading' ? 'animate-toast-icon-spin' : motion} />
      </span>
      <span className="text-sm font-medium text-app-text">{resolveValue(t.message, t)}</span>
    </div>
  )
}

// Toast #10 (picked, per explicit request) - the standard message body
// for every Save/Update confirmation across WSR/WSI/ESR/ESI/WTS. Counts
// each real figure up from 0 instead of just showing a static number -
// "numbers are the product," so a save confirmation shows the numbers,
// not just a checkmark. `stats` is an ordered list of {label, value}
// pairs (e.g. [{label:'bags', value:126}, {label:'kg', value:6249}]) -
// deliberately generic across forms, since StockFormBase counts
// bags+kilos, SackFormBase counts pieces, and WTS has two sides.
const COUNT_UP_MS = 650
export function SavedReceipt({ title, stats }) {
  const [displayed, setDisplayed] = useState(() => stats.map(() => 0))
  useEffect(() => {
    let raf
    const start = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - start) / COUNT_UP_MS)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplayed(stats.map((s) => Math.round(s.value * eased)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // stats is rebuilt fresh per toast call (a new toast id each time),
    // so this only ever needs to run once per mount, not react to
    // later prop identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <span className="text-sm font-medium text-app-text">
      <span className="block">{title}</span>
      <span className="block text-xs text-neutral-400">
        {stats.map((s, i) => (
          <span key={s.label}>
            {i > 0 && ' · '}
            {displayed[i].toLocaleString()} {s.label}
          </span>
        ))}
      </span>
    </span>
  )
}

// Toast #2 (picked, per explicit request) - for the app's own real
// background/manual sync operations (the automatic GitHub backup,
// the Google Sheets "Sync Now" button), not the continuous 30-second/
// 5-minute polling cycles - those stay silent by design, a toast on
// every one of those would be spam. `phase` is 'progress' (indeterminate
// sweep - there's no reliable byte-level progress for a fetch() upload,
// so this deliberately doesn't fake a timed fill) or 'done'.
//
// Deliberately renders NO icon of its own - AnimatedToast's outer
// wrapper already renders one based on t.type (a spinner for
// toast.loading, a checkmark for toast.success), and switches it
// automatically when a call site moves from one to the other via the
// same toast id. This component rendering its own icon on top of that
// produced two stacked spinners/checkmarks on the same toast - a real,
// reported bug, not a style choice.
export function SyncProgressToast({ label, doneLabel, phase }) {
  const isDone = phase === 'done'
  return (
    <span className="text-sm font-medium text-app-text">
      <span className="block">{isDone ? doneLabel : label}</span>
      {!isDone && (
        <span className="mt-1.5 block h-[3px] w-32 overflow-hidden rounded-full bg-neutral-800">
          <span className="block h-full w-1/3 rounded-full bg-brand-amber animate-toast-progress-sweep" />
        </span>
      )}
    </span>
  )
}

// For UpdateChecker.jsx - a persistent (duration: Infinity, fixed toast
// id so repeated poll ticks update the same card instead of stacking)
// notice that a new deploy is available, with its own explicit Update
// button rather than relying on the user noticing and tapping the whole
// toast. Deliberately renders no icon of its own, same rule as
// SyncProgressToast above - AnimatedToast's outer wrapper already
// supplies one for this toast's type ('blank' -> Info).
//
// Reported: tapping Update gave no feedback at all, which reads as a
// freeze rather than "working on it." The button disables and swaps to
// a spinner + "Updating…" the instant it's tapped, so there's visible
// feedback while the real update (downloading/installing the new
// service worker, which can genuinely take a few seconds) runs, and it
// can't be double-tapped. Per explicit follow-up feedback, no extra
// subtext line - the notification text plus the button alone are
// enough, nothing more to explain.
export function UpdateAvailableToast({ onUpdate, onForceRefresh }) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [isForcing, setIsForcing] = useState(false)
  const handleClick = () => {
    setIsUpdating(true)
    // Double rAF - guarantees the browser has actually PAINTED the
    // spinner/"Updating…" state at least once before onUpdate() runs
    // (which can involve real work - messaging the service worker,
    // eventually a full navigation). Without this, a fast enough
    // reload could tear the page down before the state change above
    // ever reached the screen, which is exactly what "no feedback, just
    // freezes" looked like when reported.
    requestAnimationFrame(() => requestAnimationFrame(onUpdate))
  }
  const handleForceRefresh = () => {
    setIsForcing(true)
    requestAnimationFrame(() => requestAnimationFrame(onForceRefresh))
  }
  return (
    <span className="text-sm font-medium text-app-text">
      <span className="block">A new version is available</span>
      <button
        type="button"
        onClick={handleClick}
        disabled={isUpdating || isForcing}
        className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-brand-neon px-2.5 py-1 text-xs font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-70"
      >
        {isUpdating && <Loader2 size={12} className="animate-spin" />}
        {isUpdating ? 'Updating…' : 'Update now'}
      </button>
      {/* Confirmed, reported real trap: a build old enough can get
          stuck where this toast's own "Update now" tap silently does
          nothing, no matter how many times the app is closed/reopened -
          the code running that tap IS the broken code, so no future fix
          can arrive through it (see appUpdate.js's forceRefresh for the
          full reasoning). This is the escape hatch: unregisters every
          service worker and clears every cache before reloading, a
          clean slate that can't get stuck the same way. Kept small/
          muted and secondary - "Update now" is still the normal path. */}
      {onForceRefresh && (
        <button
          type="button"
          onClick={handleForceRefresh}
          disabled={isUpdating || isForcing}
          className="mt-1 block text-[11px] font-medium text-neutral-500 underline decoration-dotted transition-colors hover:text-neutral-300 disabled:opacity-70"
        >
          {isForcing ? 'Refreshing…' : 'Trouble updating? Force refresh'}
        </button>
      )}
    </span>
  )
}

export default AnimatedToast
