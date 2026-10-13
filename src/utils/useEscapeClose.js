// Escape closes the topmost open modal - one handler at a time.
//
// Every modal, sheet and dialog registers here while it is open; a single window listener hands each Escape to the
// most recently opened one only, so a confirmation over a modal closes just the confirmation, and a calendar inside
// a dialog closes just the calendar. (Entry forms, the Stock Desk and a few older overlays keep their own Escape
// handling, which has its own rules.)
import { useEffect, useRef } from 'react'

const stack = []
let installed = false

const onKey = (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || stack.length === 0) return
  const top = stack[stack.length - 1]
  e.preventDefault()
  top.current?.()
}

/**
 * @param {() => void} handler the modal's own close routine (use the one that plays its exit animation)
 * @param {boolean} [enabled] false while the modal is not shown (components that stay mounted)
 */
export function useEscapeClose(handler, enabled = true) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return undefined
    if (!installed) { window.addEventListener('keydown', onKey); installed = true }
    stack.push(ref)
    return () => { const i = stack.lastIndexOf(ref); if (i >= 0) stack.splice(i, 1) }
  }, [enabled])
}
