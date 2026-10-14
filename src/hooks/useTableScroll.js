// Easier scrolling for the wide Stock Desk tables (display only):
//  - the scroll bars are large and invisible until the mouse comes close to an edge, then they light up, so they are
//    easy to find and hold (the `sb-near` class; styled in index.css under .sd-scroll);
//  - hold the SPACE bar over a table and drag with the mouse to move the table in any direction; the mouse wheel
//    keeps moving it up and down.
// Touch screens have no mouse, so nothing changes there.

import { useEffect } from 'react'

const NEAR = 56 // px from the right or bottom edge

const isTyping = (t) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

export default function useTableScroll(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    el.classList.add('sd-scroll')
    let near = false
    let hover = false
    let space = false
    let holding = false
    let drag = null

    const setNear = (v) => { if (v !== near) { near = v; el.classList.toggle('sb-near', v) } }

    const onMove = (e) => {
      if (drag) {
        el.scrollLeft = drag.l - (e.clientX - drag.x)
        el.scrollTop = drag.t - (e.clientY - drag.y)
        return
      }
      if (holding) return
      const r = el.getBoundingClientRect()
      const hasX = el.scrollWidth > el.clientWidth + 1
      const hasY = el.scrollHeight > el.clientHeight + 1
      setNear((hasX && e.clientY >= r.bottom - NEAR) || (hasY && e.clientX >= r.right - NEAR))
    }
    const onEnter = () => { hover = true }
    const onLeave = () => { hover = false; if (!holding && !drag) setNear(false) }
    const onDown = (e) => {
      if (space && e.button === 0) {
        drag = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop }
        el.classList.add('sd-grabbing')
        e.preventDefault()
      } else if (near) {
        holding = true // a scroll bar being dragged stays large until it is let go
      }
    }
    const onUp = () => {
      holding = false
      if (drag) { drag = null; el.classList.remove('sd-grabbing') }
      if (!hover) setNear(false)
    }
    const onKeyDown = (e) => {
      if (e.code !== 'Space' || !hover || isTyping(e.target)) return
      e.preventDefault()
      if (!space) { space = true; el.classList.add('sd-grab') }
    }
    const onKeyUp = (e) => {
      if (e.code !== 'Space') return
      space = false
      el.classList.remove('sd-grab', 'sd-grabbing')
      drag = null
    }

    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    el.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      el.classList.remove('sd-scroll', 'sb-near', 'sd-grab', 'sd-grabbing')
    }
  }, [ref])
}
