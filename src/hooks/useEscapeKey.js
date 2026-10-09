import { useEffect, useRef } from 'react'

/**
 * While `active`, the Escape key calls `handler` (and is consumed). Skipped while a dialog or picker
 * that owns the keyboard is open (the `data-suppress-form-shortcuts` convention), because those
 * handle Escape themselves.
 */
export default function useEscapeKey(active, handler) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[data-suppress-form-shortcuts]')) return
      e.preventDefault()
      ref.current?.(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
