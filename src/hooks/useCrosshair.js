// Row and column highlight for the report tables: while the mouse is over a cell,
// the whole row and the whole column of that cell are tinted, and the cell itself
// a little stronger. It works from where the cells actually are on screen, so it
// also copes with merged header cells, row-spanning cells and a scaled table.
// Touch screens have no hover, so nothing changes there. Display only.

import { useEffect } from 'react'

export default function useCrosshair(ref) {
  useEffect(() => {
    const root = ref.current
    if (!root) return undefined
    let marked = []
    let last = null

    const clear = () => {
      for (const el of marked) el.classList.remove('hl-line', 'hl-cross')
      marked = []
      last = null
    }

    const onOver = (e) => {
      const cell = e.target.closest?.('td,th')
      if (!cell || !root.contains(cell) || cell === last) return
      clear()
      last = cell
      const table = cell.closest('table')
      if (!table) return
      const r = cell.getBoundingClientRect()
      const cx = (r.left + r.right) / 2
      const cy = (r.top + r.bottom) / 2
      const hoveredIsFirstCol = cell.matches(':first-child')
      const hits = []
      for (const c of table.querySelectorAll('td,th')) {
        const b = c.getBoundingClientRect()
        const inRow = b.top <= cy && b.bottom >= cy
        // the sticky first column and wide section rows must not light up as a "column"
        const columnEligible = (hoveredIsFirstCol || !c.matches(':first-child')) && (c.colSpan === 1 || c.tagName === 'TH')
        const inCol = columnEligible && b.left <= cx && b.right >= cx
        if (inRow || inCol) hits.push(c)
      }
      for (const c of hits) { c.classList.add(c === cell ? 'hl-cross' : 'hl-line'); marked.push(c) }
    }

    root.addEventListener('mouseover', onOver)
    root.addEventListener('mouseleave', clear)
    return () => {
      root.removeEventListener('mouseover', onOver)
      root.removeEventListener('mouseleave', clear)
      clear()
    }
  }, [ref])
}
