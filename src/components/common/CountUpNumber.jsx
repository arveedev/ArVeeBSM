// Concept B (picked) - counts a displayed number up (or down) from its
// previous value to a new one, instead of just snapping to the new
// figure. Used for headline dashboard totals - "numbers are the
// product," so the number changing is worth seeing happen, not just
// the end result. Renders through whatever formatter the caller
// already uses (fmtNetBags, fmtWeight, etc.), so unit/decimal handling
// stays exactly as it was - this only interpolates the raw value.

import { useEffect, useRef, useState } from 'react'

const COUNT_UP_MS = 550

const CountUpNumber = ({ value, format = (v) => String(v) }) => {
  const [displayed, setDisplayed] = useState(0)
  const prevRef = useRef(0)

  useEffect(() => {
    const from = prevRef.current
    const to = value ?? 0
    prevRef.current = to
    if (from === to) {
      setDisplayed(to)
      return
    }
    let raf
    const start = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - start) / COUNT_UP_MS)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplayed(from + (to - from) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])

  return format(displayed)
}

export default CountUpNumber
