import { useEffect, useRef, useState } from 'react'

// Action Selector Flyout Sheet — Step 4.3 (updated layout per user spec).
//
// Row 1: WSR | WSI
// Row 2: ESR | ESI
// Row 3: WTS (full-width, same size as 2 buttons above)
//
// All buttons have hover glow + tap scale animations. Tapping the backdrop
// or "Cancel" closes the sheet.

const ROWS = [
  ['WSR', 'WSI'],
  ['ESR', 'ESI'],
]

const LABEL_MAP = {
  WSR: 'WSR',
  WSI: 'WSI',
  ESR: 'ESR',
  ESI: 'ESI',
  WTS: 'WTS',
}

// Must match the transition duration used on the sheet/backdrop below.
const SHEET_ANIMATION_MS = 200

// Flat row-major order (matches the visual grid: WSR/WSI, ESR/ESI, then
// WTS) - used for Up/Down arrow-key navigation between the 5 type
// buttons, same convention AuthorityPickerModal.jsx already uses for
// its own record list.
const FLAT_TYPE_ORDER = ['WSR', 'WSI', 'ESR', 'ESI', 'WTS']

function TransactionModal({ open, onClose, onSelectType }) {
  const [hasEntered, setHasEntered] = useState(false)
  const [shouldRender, setShouldRender] = useState(open)
  const buttonRefs = useRef({})

  // Per explicit request ("Space/Enter on the + button opens the same
  // type-selection UI, then arrow keys pick a type"): focuses the first
  // type button the moment this sheet finishes entering, and Up/Down
  // moves between all 5 in the flat order above. Escape closes, same
  // convention as every other overlay in the app.
  useEffect(() => {
    if (!hasEntered) return
    buttonRefs.current[FLAT_TYPE_ORDER[0]]?.focus()
  }, [hasEntered])

  const handleSheetKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const currentIndex = FLAT_TYPE_ORDER.findIndex((t) => buttonRefs.current[t] === document.activeElement)
    const nextIndex = e.key === 'ArrowDown'
      ? Math.min(currentIndex + 1, FLAT_TYPE_ORDER.length - 1)
      : Math.max(currentIndex - 1, 0)
    buttonRefs.current[FLAT_TYPE_ORDER[nextIndex === -1 ? 0 : nextIndex]]?.focus()
  }

  // Sheet slides up fast from below on open, and slides back down on
  // close (the reverse), with the backdrop fading in/out over the same
  // duration - rendering is kept alive briefly after close is
  // requested so the exit animation actually has time to play, rather
  // than the sheet just vanishing instantly.
  useEffect(() => {
    if (open) {
      setShouldRender(true)
    } else {
      setHasEntered(false)
      const timer = setTimeout(() => setShouldRender(false), SHEET_ANIMATION_MS)
      return () => clearTimeout(timer)
    }
  }, [open])

  // Separate effect, keyed on shouldRender rather than open directly -
  // this only runs AFTER shouldRender's own update above has actually
  // committed and rendered (with hasEntered still false, showing the
  // off-screen starting position), so requestAnimationFrame here gets
  // a genuine "next frame" to transition from, rather than both state
  // changes landing in the same render and skipping the visible start.
  useEffect(() => {
    if (!shouldRender || !open) return
    const frame = requestAnimationFrame(() => setHasEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [shouldRender, open])

  if (!shouldRender) return null

  const handleSelect = (type) => {
    onClose()
    onSelectType(type)
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center transition-colors duration-200 ${hasEntered ? 'bg-black/60' : 'bg-black/0'}`}
      onClick={onClose}
    >
      <div
        style={{
          transform: hasEntered ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 200ms ease-out',
        }}
        className="w-full max-w-md rounded-t-3xl border border-neutral-800 bg-neutral-900 p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleSheetKeyDown}
      >
        {/* drag handle */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-700" />
        <h2 className="mb-4 text-center text-base font-semibold text-app-text">
          Select Form
        </h2>

        {/* Rows 1 & 2: WSR/WSI then ESR/ESI */}
        <div className="space-y-2">
          {ROWS.map((pair) => (
            <div key={pair.join()} className="grid grid-cols-2 gap-2">
              {pair.map((type) => (
                <FormButton
                  key={type}
                  type={type}
                  buttonRef={(el) => { buttonRefs.current[type] = el }}
                  onClick={() => handleSelect(type)}
                />
              ))}
            </div>
          ))}

          {/* Row 3: WTS full-width */}
          <FormButton
            type="WTS"
            fullWidth
            buttonRef={(el) => { buttonRefs.current.WTS = el }}
            onClick={() => handleSelect('WTS')}
          />
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-3 text-sm font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-95"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function FormButton({ type, onClick, fullWidth = false, buttonRef }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className={`${fullWidth ? 'w-full' : ''} rounded-xl border border-brand-neon/30 bg-neutral-950 py-4 text-sm font-semibold text-brand-neon transition-all hover:border-brand-neon hover:bg-brand-neon/10 hover:shadow-[0_0_20px_rgba(0,255,163,0.3)] active:scale-95`}
    >
      {LABEL_MAP[type]}
    </button>
  )
}

export default TransactionModal
