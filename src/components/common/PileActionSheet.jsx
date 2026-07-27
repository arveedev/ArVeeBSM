// Pile action menu — appears as a compact popover right next to the
// tapped pile card (not a bottom sheet, which hid WTS below the nav
// bar). Positions itself above or below the card depending on which
// direction actually has room in the viewport, so a pile near the
// bottom of the list is never rendered off-screen with no way to reach
// it. Measures its own real rendered height (not an estimate) before
// revealing itself, via useLayoutEffect - runs synchronously before
// paint, so there's no visible flash/jump from repositioning. Bounces
// in once on appear as a visual cue that it's now available.
//
// Color convention (fixed app-wide rule): green/neon = issuances,
// amber/orange = receipts. WSR is a receipt, WSI is an issue.

import { useLayoutEffect, useRef, useState } from 'react'

const OPTIONS = [
  { type: 'WSR', color: 'text-brand-amber hover:bg-brand-amber/10' },
  { type: 'WSI', color: 'text-brand-neon hover:bg-brand-neon/10' },
  { type: 'WTS', color: 'text-neutral-300 hover:bg-neutral-800' },
]

// Height of the fixed BottomNav (h-16 = 64px) - it visually covers the
// bottom of the viewport regardless of scroll position, so raw
// window.innerHeight overstates how much space is actually usable there.
const BOTTOM_NAV_HEIGHT = 64

function PileActionSheet({ onSelect, onClose }) {
  const menuRef = useRef(null)
  const [placement, setPlacement] = useState(null) // null while measuring - stays invisible

  useLayoutEffect(() => {
    if (!menuRef.current) return
    const actualHeight = menuRef.current.offsetHeight
    const parentRect = menuRef.current.parentElement.getBoundingClientRect()
    const spaceBelow = window.innerHeight - BOTTOM_NAV_HEIGHT - parentRect.bottom
    const spaceAbove = parentRect.top
    // Prefer below (matches the natural reading direction); only flip
    // upward if there's genuinely not enough room below AND there's
    // more room above than below - using the REAL measured height, not
    // a guess, so this can never under-estimate and clip itself.
    setPlacement(spaceBelow < actualHeight && spaceAbove > spaceBelow ? 'up' : 'down')
  }, [])

  useLayoutEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className={`absolute right-0 z-30 flex overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl shadow-black/60 ${
        placement ? 'animate-bounce-in' : 'invisible'
      } ${placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'}`}
      onClick={(e) => e.stopPropagation()}
    >
      {OPTIONS.map(({ type, color }) => (
        <button
          key={type}
          type="button"
          onClick={() => onSelect(type)}
          className={`px-4 py-2.5 text-sm font-semibold transition-colors active:scale-95 ${color}`}
        >
          {type}
        </button>
      ))}
    </div>
  )
}

export default PileActionSheet
