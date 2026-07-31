import { useEffect, useState } from 'react'

/**
 * Wraps a banner-style element (e.g. "reviewing existing" / "needs
 * completion" notices) with a slide-down-fade-in entrance and
 * slide-up-fade-out exit, instead of it abruptly appearing/
 * disappearing via plain conditional rendering.
 *
 * show: whether the banner should currently be visible. Internally
 * keeps the element mounted for a short extra window after show
 * flips to false, so the exit animation has time to actually play
 * before the element is removed from the DOM.
 */
function AnimatedBanner({ show, children, className = '' }) {
  const [shouldRender, setShouldRender] = useState(show)
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    if (show) {
      setShouldRender(true)
      setIsExiting(false)
    } else if (shouldRender) {
      setIsExiting(true)
      const timeout = setTimeout(() => {
        setShouldRender(false)
        setIsExiting(false)
      }, 250)
      return () => clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  if (!shouldRender) return null

  return (
    <div className={`${className} ${isExiting ? 'animate-banner-out' : 'animate-banner-in'}`}>
      {children}
    </div>
  )
}

export default AnimatedBanner
