// StickyWarehouseIndicator — shows a small "which warehouse am I in"
// reminder once the real selector/display has scrolled out of view.
// Shared across every page with a warehouse selector (Home, Piles,
// Reports, Settings) instead of duplicating the same
// IntersectionObserver logic in each one.
//
// Usage: pass the same ref used on the actual selector's wrapper div
// as `targetRef`, and the current warehouse object.

import { useEffect, useRef, useState } from 'react'
import { usePageHeader } from '../../context/PageHeaderContext.jsx'

function StickyWarehouseIndicator({ targetRef, warehouse }) {
  const [isTargetVisible, setIsTargetVisible] = useState(true)
  const { headerHeight, setStickyIndicatorHeight } = usePageHeader() ?? {}
  const selfRef = useRef(null)

  useEffect(() => {
    const target = targetRef.current
    if (!target) return
    const observer = new IntersectionObserver(
      ([entry]) => setIsTargetVisible(entry.isIntersecting),
      { threshold: 0 }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [targetRef])

  const isShowing = !isTargetVisible && Boolean(warehouse)

  // Reports this indicator's own real height only while it's actually
  // showing (0 otherwise) - anything elsewhere on the page that needs
  // to scroll below both the header AND this docked indicator can then
  // use the exact real total, not a guess.
  useEffect(() => {
    if (!isShowing) {
      setStickyIndicatorHeight?.(0)
      return
    }
    const el = selfRef.current
    if (!el || !setStickyIndicatorHeight) return
    const observer = new ResizeObserver(([entry]) => setStickyIndicatorHeight(entry.contentRect.height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [isShowing, setStickyIndicatorHeight])

  if (!isShowing) return null

  return (
    <div
      ref={selfRef}
      style={{ top: `${headerHeight ?? 60}px` }}
      className="sticky z-30 -mx-4 mb-2 border-b border-neutral-800 bg-neutral-950 px-4 py-2"
    >
      <p className="text-base font-bold text-brand-neon">
        {warehouse.code} — {warehouse.name}
      </p>
    </div>
  )
}

export default StickyWarehouseIndicator
