// Small shared pieces of the Stock Desk: a modal overlay that animates in and out and closes on
// Escape, and an expandable card. Nothing here touches data.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import useDelayedUnmount from '../../hooks/useDelayedUnmount.js'
import useEscapeKey from '../../hooks/useEscapeKey.js'

const EXIT_MS = 200

/**
 * A modal that fades its backdrop and pops its panel in, and plays the reverse before it is removed.
 * Escape closes it. `align` is 'center' (a dialog) or 'sheet' (bottom sheet on a phone, a panel under
 * the toolbar on a wide screen). Marked data-sd-overlay so the Stock Desk's own Escape (back to the menu)
 * stays out of its way while it is open.
 */
export function SdOverlay({ open, onClose, align = 'center', z = 'z-[90]', panelClassName = '', children }) {
  const mounted = useDelayedUnmount(open, EXIT_MS)
  useEscapeKey(open, onClose)
  if (!mounted) return null
  const place = align === 'sheet' ? 'items-end sm:items-start sm:justify-end sm:p-4' : 'items-end sm:items-center sm:justify-center sm:p-4'
  return createPortal(
    <div data-sd-overlay className={`fixed inset-0 ${z} flex ${place} bg-black/60 ${open ? 'sd-fade-in' : 'sd-fade-out'}`} onClick={onClose}>
      <div className={`${panelClassName} ${open ? 'sd-pop-in' : 'sd-pop-out'}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** A card whose body opens and closes smoothly; the header shows a title and a count on the right. */
export function ExpandCard({ title, count, tone = 'text-amber-400', ok = false, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const countTone = ok || count === 0 ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300' : 'border-amber-600/50 bg-amber-950/40 text-amber-300'
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 p-3 text-left">
        <span className={`min-w-0 flex-1 break-words text-xs font-bold uppercase tracking-wide ${count === 0 || ok ? 'text-brand-neon' : tone}`}>{title}</span>
        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold tabular-nums ${countTone}`}>{count}</span>
        <ChevronDown size={16} className={`shrink-0 text-neutral-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-neutral-800 px-3 pb-3 pt-2">{children}</div>
        </div>
      </div>
    </div>
  )
}
