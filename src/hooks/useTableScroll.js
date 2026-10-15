// Easier scrolling for the wide Stock Desk tables (display only):
//  - the scroll bars are large and invisible until the mouse comes close to an edge, then they light up, so they are
//    easy to find and hold (the `sb-near` class; styled in index.css under .sd-scroll);
//  - hold the SPACE bar with the pointer over a table and drag with the mouse to move the table in any direction; the
//    mouse wheel keeps moving it up and down. While Space is held a small "drag to move" note shows at the bottom of the
//    screen, so you can see the key was noticed.
// Works from where the pointer actually is (not from enter / leave events), listens before anything else can swallow the
// key, and keeps the drag going even when the pointer leaves the table. Touch screens are left alone.

import { useEffect } from 'react'

const NEAR = 56 // px from the right or bottom edge

const isTyping = (t) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

let chip = null
const showChip = (on) => {
  if (on) {
    if (!chip) {
      chip = document.createElement('div')
      chip.textContent = 'Hold Space and drag to move the table'
      chip.style.cssText = 'position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:300;padding:6px 14px;border-radius:999px;font:700 12px Inter,system-ui,sans-serif;background:rgba(0,255,163,.16);color:#00FFA3;border:1px solid rgba(0,255,163,.5);pointer-events:none'
    }
    if (!chip.isConnected) document.body.appendChild(chip)
  } else if (chip?.isConnected) {
    chip.remove()
  }
}

export default function useTableScroll(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    el.classList.add('sd-scroll')
    let near = false
    let space = false
    let holding = false
    let drag = null
    let px = -1
    let py = -1

    const setNear = (v) => { if (v !== near) { near = v; el.classList.toggle('sb-near', v) } }
    const over = () => {
      if (px < 0) return false
      const t = document.elementFromPoint(px, py)
      return Boolean(t && el.contains(t))
    }
    const endSpace = () => {
      space = false
      el.classList.remove('sd-grab', 'sd-grabbing')
      showChip(false)
    }

    const onPointerMove = (e) => {
      if (e.pointerType === 'touch') return
      px = e.clientX
      py = e.clientY
      if (drag) {
        el.scrollLeft = drag.l - (e.clientX - drag.x)
        el.scrollTop = drag.t - (e.clientY - drag.y)
        return
      }
      if (holding) return
      const r = el.getBoundingClientRect()
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      if (!inside) { setNear(false); return }
      const hasX = el.scrollWidth > el.clientWidth + 1
      const hasY = el.scrollHeight > el.clientHeight + 1
      setNear((hasX && e.clientY >= r.bottom - NEAR) || (hasY && e.clientX >= r.right - NEAR))
    }
    const onPointerDown = (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return
      if (space) {
        drag = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop }
        el.classList.add('sd-grabbing')
        try { el.setPointerCapture(e.pointerId) } catch { /* the drag still works without it */ }
        e.preventDefault()
      } else if (near) {
        holding = true // a scroll bar being dragged stays large until it is let go
      }
    }
    const onPointerUp = () => {
      holding = false
      drag = null
      el.classList.remove('sd-grabbing')
      if (!over()) setNear(false)
    }
    const onKeyDown = (e) => {
      if (e.code !== 'Space' || isTyping(e.target) || !over()) return
      e.preventDefault()
      e.stopPropagation()
      // a button that still has the focus must not be pressed by this Space
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur()
      if (!space) { space = true; el.classList.add('sd-grab'); showChip(true) }
    }
    const onKeyUp = (e) => {
      if (e.code !== 'Space' || !space) return
      e.preventDefault()
      endSpace()
      drag = null
    }

    window.addEventListener('pointermove', onPointerMove, true)
    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', endSpace)
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true)
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', endSpace)
      showChip(false)
      el.classList.remove('sd-scroll', 'sb-near', 'sd-grab', 'sd-grabbing')
    }
  }, [ref])
}
