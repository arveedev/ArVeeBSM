import { useEffect, useState } from 'react'

/**
 * Keeps a conditionally-rendered element mounted for `exitDuration`ms
 * after `isVisible` becomes false, so a CSS exit animation actually
 * has time to play before the element is removed from the DOM -
 * without this, toggling a section off just instantly disappears it,
 * with no way for any exit animation to ever be seen.
 *
 * Usage:
 *   const shouldRender = useDelayedUnmount(isOpen, 250)
 *   {shouldRender && (
 *     <div className={isOpen ? 'animate-flow-down' : 'animate-flow-up-exit'}>
 *       ...
 *     </div>
 *   )}
 *
 * @param {boolean} isVisible - whether the section should currently be shown
 * @param {number} exitDuration - how long the exit animation takes, in ms (should match the CSS animation-duration used for the exit class)
 * @returns {boolean} whether the element should still be rendered (true while visible, and briefly true after becoming hidden to let the exit play)
 */
export default function useDelayedUnmount(isVisible, exitDuration = 250) {
  const [shouldRender, setShouldRender] = useState(isVisible)

  useEffect(() => {
    if (isVisible) {
      setShouldRender(true)
      return
    }
    const timer = setTimeout(() => setShouldRender(false), exitDuration)
    return () => clearTimeout(timer)
  }, [isVisible, exitDuration])

  return shouldRender
}
