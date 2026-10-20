// A tiny sheet model shared by every GSR sheet and by the audit file (pure, no database).
// Cells are 0-based (row, col). A cell is a number, a string, null (blank), or { f: '=SUM(D18:D27)', v: 12.5 } where v is the
// value the formula must give (kept so the read-back from Drive can check it).

export const colLetter = (c) => {
  let n = c + 1
  let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}
export const refOf = (r, c) => `${colLetter(c)}${r + 1}`
export const rangeOf = (r1, c1, r2, c2) => `${refOf(r1, c1)}:${refOf(r2, c2)}`

// Zero shows as an empty cell (owner, 2026-10-20): the third section of the format is empty.
export const BAGS_FORMAT = '#,##0.00;-#,##0.00;;@'
export const COUNT_FORMAT = '#,##0;-#,##0;;@'

export class SheetBuilder {
  constructor(name) {
    this.name = name
    this.cells = new Map() // "r,c" -> cell
    this.merges = []       // [r1, c1, r2, c2]
    this.formats = []      // [r1, c1, r2, c2, format]
    this.bold = []         // [r1, c1, r2, c2]
    this.fills = []        // [r1, c1, r2, c2, color]
    this.align = []        // [r1, c1, r2, c2, 'center' | 'right' | 'left']
    this.colWidths = {}
    this.meta = {}         // free information for the audit (labels by row / column)
  }

  set(r, c, cell) { this.cells.set(`${r},${c}`, cell); return this }
  get(r, c) { return this.cells.get(`${r},${c}`) ?? null }
  merge(r1, c1, r2, c2) { this.merges.push([r1, c1, r2, c2]) }
  format(r1, c1, r2, c2, fmt) { this.formats.push([r1, c1, r2, c2, fmt]) }
  boldRange(r1, c1, r2, c2) { this.bold.push([r1, c1, r2, c2]) }
  fill(r1, c1, r2, c2, color) { this.fills.push([r1, c1, r2, c2, color]) }
  alignRange(r1, c1, r2, c2, a) { this.align.push([r1, c1, r2, c2, a]) }

  get rowCount() { let n = 0; for (const k of this.cells.keys()) n = Math.max(n, Number(k.split(',')[0]) + 1); return n }
  get colCount() { let n = 0; for (const k of this.cells.keys()) n = Math.max(n, Number(k.split(',')[1]) + 1); return n }

  /** What the receiver writes: a rectangular array (formulas as strings starting with =), plus the layout. */
  toPayload() {
    const R = this.rowCount
    const C = this.colCount
    const rows = Array.from({ length: R }, () => Array(C).fill(''))
    for (const [k, cell] of this.cells) {
      const [r, c] = k.split(',').map(Number)
      rows[r][c] = cell != null && typeof cell === 'object' ? cell.f : (cell ?? '')
    }
    return { name: this.name, rows, merges: this.merges, formats: this.formats, bold: this.bold, fills: this.fills, align: this.align, colWidths: this.colWidths }
  }

  /** ref -> the value that must be read back (numbers and text; blanks are not listed). */
  expected() {
    const out = new Map()
    for (const [k, cell] of this.cells) {
      const [r, c] = k.split(',').map(Number)
      const v = cell != null && typeof cell === 'object' ? cell.v : cell
      if (v === null || v === undefined || v === '') continue
      out.set(refOf(r, c), v)
    }
    return out
  }
}
