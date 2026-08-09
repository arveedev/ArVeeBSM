import { useEffect, useRef, useState } from 'react'

// Overlays the crossfade-slide text animation on top of the real
// serial number <input> during step-navigation only - the input box
// itself never moves, only this overlay's text does, per explicit
// request. Only active while navFlash is set (which the existing
// step-back/step-forward handlers already set for exactly this
// window), so normal typing is completely unaffected: the real
// input's own text stays visible and this overlay renders nothing.
//
// While a navigation animation is in flight, the real input's text is
// made transparent (by the caller, via inputTextColorClass) so this
// overlay's text is the only thing visible, avoiding any double-text
// overlap between the two layers.
function SerialCrossfadeOverlay({ value, navFlash }) {
  const [outgoing, setOutgoing] = useState(null)
  const previousValueRef = useRef(value)

  useEffect(() => {
    if (navFlash && previousValueRef.current !== value) {
      const outgoingText = previousValueRef.current
      setOutgoing({ text: outgoingText, direction: navFlash })
      const t = setTimeout(() => setOutgoing(null), 350)
      previousValueRef.current = value
      return () => clearTimeout(t)
    }
    previousValueRef.current = value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  if (!navFlash) return null

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl">
      {outgoing && (
        <span
          className={`absolute font-mono text-app-text ${
            outgoing.direction === 'forward' ? 'animate-serial-exit-left' : 'animate-serial-exit-right'
          }`}
        >
          {outgoing.text}
        </span>
      )}
      <span
        key={value}
        className={`absolute font-mono text-app-text ${
          navFlash === 'forward' ? 'animate-serial-enter-right' : 'animate-serial-enter-left'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

export default SerialCrossfadeOverlay
