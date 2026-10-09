import { useEffect } from 'react'

/** While `active`, the page behind a full-screen overlay cannot scroll (so it shows no second scrollbar). */
export default function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined
    const html = document.documentElement
    const body = document.body
    const before = { html: html.style.overflow, body: body.style.overflow }
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => { html.style.overflow = before.html; body.style.overflow = before.body }
  }, [active])
}
