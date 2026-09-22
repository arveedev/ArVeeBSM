// Tracks user activity (mouse/touch/keyboard/scroll) against a rolling
// idle clock. When idle time crosses `idleTimeoutMs`, calls `onIdle()`
// exactly once. `secondsLeft` counts down from `warningLeadMs` once idle
// time enters that final window, so a caller can show a "closing in Xs"
// prompt - `resetActivity()` (or any tracked window event) cancels it.
//
// A single 1s interval per instance, not a rescheduled setTimeout on
// every mousemove/keydown - the event listeners themselves only ever
// touch a ref, so this stays cheap regardless of how often activity
// fires (e.g. continuous typing in a form).
//
// Built for the entry-form auto-exit / SDO auto-logout feature (see
// App.jsx and the individual form components) - generic enough to be
// reused for either, at different idleTimeoutMs values.

import { useEffect, useRef, useState } from 'react'

export function useIdleCountdown({ idleTimeoutMs, warningLeadMs = 0, onIdle, enabled = true }) {
  const [secondsLeft, setSecondsLeft] = useState(null)
  const lastActivityRef = useRef(Date.now())
  const firedRef = useRef(false)
  // Ref, not a direct dependency - a caller passing an inline arrow
  // function for onIdle (the common case) would otherwise re-run the
  // whole effect (tearing down and re-adding every event listener) on
  // every single render, not just when the real inputs actually change.
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  const resetActivity = () => {
    lastActivityRef.current = Date.now()
    firedRef.current = false
    setSecondsLeft(null)
  }

  useEffect(() => {
    if (!enabled) {
      setSecondsLeft(null)
      return
    }
    resetActivity()

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel']
    events.forEach((e) => window.addEventListener(e, resetActivity, { passive: true }))

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current
      const remaining = idleTimeoutMs - elapsed
      if (remaining <= 0) {
        if (!firedRef.current) {
          firedRef.current = true
          setSecondsLeft(null)
          onIdleRef.current?.()
        }
        return
      }
      setSecondsLeft(remaining <= warningLeadMs ? Math.ceil(remaining / 1000) : null)
    }, 1000)

    return () => {
      clearInterval(interval)
      events.forEach((e) => window.removeEventListener(e, resetActivity))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idleTimeoutMs, warningLeadMs])

  return { secondsLeft, resetActivity }
}
