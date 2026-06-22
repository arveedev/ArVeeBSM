// Pile action menu — appears as a compact popover right next to the
// tapped pile card (not a bottom sheet, which hid WTS below the nav bar).
// No subtext — the user already knows what WSR/WSI/WTS mean. Pre-fills
// pileId and varietyId on whichever form is chosen.

import { useEffect, useRef } from 'react'

const OPTIONS = [
  { type: 'WSR', color: 'text-brand-neon hover:bg-brand-neon/10' },
  { type: 'WSI', color: 'text-brand-amber hover:bg-brand-amber/10' },
  { type: 'WTS', color: 'text-neutral-300 hover:bg-neutral-800' },
]

function PileActionSheet({ onSelect, onClose }) {
  const menuRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="absolute right-0 top-full z-30 mt-1 flex overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl shadow-black/60"
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
