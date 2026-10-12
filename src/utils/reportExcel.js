// Excel versions of the printed reports (Stock Report, BIN Card, Pile Layout, SDO Abstract,
// CPF Cash Disbursement Record).
//
// Each report's PDF generator records what it prints (see pdfCapture.js); this file turns
// that record into a workbook, so the Excel file always shows the same rows and totals as
// the PDF. The spreadsheet library is imported only when Export is tapped. Read-only: the
// file is built in memory and downloaded; nothing in the app's data is touched.

import { groupHeading } from './pileStockGroups.js'

const NUMBER_LIKE = /^[₱]?\s?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d+$|^[₱]?\s?-?\d{1,3}(?:,\d{3})+$/

const loadExcel = async () => {
  const mod = await import('exceljs')
  return mod.default ?? mod
}

const download = async (wb, fileName) => {
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const fmtFor = (dec, dash = false) => {
  const f = '#,##0' + (dec ? '.' + '0'.repeat(dec) : '')
  return dash ? `${f};-${f};"-"` : f
}

// "62,000.00" and "1,240" become real numbers (so Excel can add them up) with the same number of
// decimals as printed. Anything with a leading zero ("0415"), letters or hyphens stays text -
// unless `numericColumn` says the whole column holds quantities, where bare integers and the
// "-" placeholder for nothing are numbers too (shown as "-" again by the number format).
export const asCell = (v, numericColumn = false, colDec = 0) => {
  if (typeof v === 'number') return { value: v }
  const s = String(v ?? '')
  const t = s.trim()
  if (NUMBER_LIKE.test(t) && !/^[₱]?\s?-?0\d/.test(t)) {
    const num = Number(t.replace(/[₱,\s]/g, ''))
    if (Number.isFinite(num)) {
      const dec = (t.split('.')[1] || '').length
      return { value: num, numFmt: fmtFor(dec) }
    }
  }
  if (numericColumn) {
    if (/^-?(0|[1-9]\d*)$/.test(t)) return { value: Number(t), numFmt: fmtFor(colDec) }
    if (t === '-') return { value: 0, numFmt: fmtFor(colDec, true) }
  }
  return { value: s }
}

// The PDF breaks long ids after hyphens ("05- 05- 10-") and stacks dates over two lines; in a spreadsheet they read as one value.
const tidy = (v) => (typeof v === 'string' ? v.replace(/(\d)- (?=\d)/g, '$1-').replace(/^([A-Za-z]{3})\n(\d{1,2})$/, '$1 $2') : v)

const argb = (rgb) => (Array.isArray(rgb) ? 'FF' + rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('') : null)
const FONT = 'Arial'
const BODY_PT = 7
const HEAD_FILL = 'FFC8C8C8'
const ALT_FILL = 'FFF8F8F8'
const hair = { style: 'thin', color: { argb: 'FFB4B4B4' } }
const bodyBorder = { top: hair, left: hair, bottom: hair, right: hair }
const heavy = { style: 'medium', color: { argb: 'FF000000' } }
const headBorder = { top: heavy, left: heavy, bottom: heavy, right: heavy }
const NUMERIC_HEAD = /bags|kls|kilos|kg\b|qty|quantit|amount|balance|total|debit|credit|receipt|issue|price|cost|₱|peso|sacks|withdraw|deposit/i
const TOTAL_LABEL = /^\s*(GRAND\s+|SUB[-\s]?)?TOTAL\b/i
const colName = (c) => { let n = '', k = c; while (k > 0) { n = String.fromCharCode(65 + ((k - 1) % 26)) + n; k = Math.floor((k - 1) / 26) } return n }
const textOf = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const cellText = (o) => textOf(tidy(o && typeof o === 'object' ? o.content : o))
const quoteSheet = (n) => `'${String(n).replace(/'/g, "''")}'`

// Printed millimetres <-> Excel column width (characters of the default font), so the sheet prints at the
// same proportions as the PDF page.
const MM_PX = 96 / 25.4
const mmToChars = (mm) => Math.max(1.2, (mm * MM_PX - 5) / 7)
const charsToMm = (ch) => (ch * 7 + 5) / MM_PX
const PAGE_MARGIN_MM = 14

// Lays autoTable-style rows (strings, or { content, colSpan, rowSpan, styles }) onto grid
// coordinates, honouring merged cells.
const layoutRows = (rows, startRow, c0) => {
  const taken = new Set()
  const out = []
  rows.forEach((row, ri) => {
    const r = startRow + ri
    let c = c0
    for (const cell of row) {
      while (taken.has(`${r}:${c}`)) c++
      const o = cell !== null && typeof cell === 'object' ? cell : { content: cell }
      const cs = o.colSpan || 1, rs = o.rowSpan || 1
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) taken.add(`${r + dr}:${c + dc}`)
      out.push({ r, c, cs, rs, o })
      c += cs
    }
  })
  return out
}

// Places one captured table (head, body, foot) the way it prints. Returns what the formula passes need.
const placeTable = (ws, startRow, t, ctx) => {
  const c0 = 1 + ctx.off
  const head = layoutRows(t.head || [], startRow, c0)
  const bodyStart = startRow + (t.head || []).length
  const body = layoutRows(t.body || [], bodyStart, c0)
  const footStart = bodyStart + (t.body || []).length
  const foot = layoutRows(t.foot || [], footStart, c0)

  const headText = {}
  head.forEach((x) => { for (let k = 0; k < x.cs; k++) headText[x.c + k] = (headText[x.c + k] || '') + ' ' + cellText(x.o) })
  const numCols = new Set(), dec = {}
  const scan = (list) => list.forEach((x) => {
    if (x.cs > 1) return
    const t0 = cellText(x.o).trim()
    if (NUMBER_LIKE.test(t0) && !/^[₱]?\s?-?0\d/.test(t0)) { numCols.add(x.c); dec[x.c] = Math.max(dec[x.c] || 0, (t0.split('.')[1] || '').length) }
  })
  scan(body); scan(foot)
  Object.keys(headText).forEach((c) => { if (NUMERIC_HEAD.test(headText[c])) numCols.add(Number(c)) })

  const rowIsTotal = new Set()
  foot.forEach((x) => rowIsTotal.add(x.r))
  body.forEach((x) => { if (TOTAL_LABEL.test(cellText(x.o))) rowIsTotal.add(x.r) })

  const put = (list, kind) => list.forEach(({ r, c, cs, rs, o }) => {
    if (cs > 1 || rs > 1) ws.mergeCells(r, c, r + rs - 1, c + cs - 1)
    const t0 = asCell(tidy(o.content), kind !== 'head' && cs === 1 && numCols.has(c), dec[c] || 0)
    const wc = ws.getCell(r, c)
    wc.value = t0.value
    if (t0.numFmt) wc.numFmt = t0.numFmt
    const st = o.styles || {}
    const bold = kind === 'head' || /bold/.test(st.fontStyle || '') || (kind !== 'body') || rowIsTotal.has(r) && false
    wc.font = { name: FONT, size: st.fontSize && st.fontSize < 9 ? st.fontSize : BODY_PT, bold, italic: /italic/.test(st.fontStyle || ''), color: argb(st.textColor) ? { argb: argb(st.textColor) } : undefined }
    const colHalign = t.colHalign && t.colHalign[c - c0]
    wc.alignment = {
      horizontal: kind === 'head' ? 'center' : (st.halign || colHalign || (typeof t0.value === 'number' ? 'right' : 'left')),
      vertical: 'middle',
      wrapText: true,
    }
    const bd = kind === 'head' ? headBorder : bodyBorder
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) ws.getCell(r + dr, c + dc).border = bd
    if (kind === 'head') wc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(t.headFill ?? t.headStyle?.fillColor) ?? HEAD_FILL } }
    else if (argb(st.fillColor)) wc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(st.fillColor) } }
    else if ((r - bodyStart) % 2 === 1 && kind === 'body') wc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_FILL } }
    if (kind === 'head' && rs === 1) {
      // enough height for the wrapped heading (7pt bold is roughly 1.45 mm per character)
      const mm = t.colWidths ? t.colWidths.slice(c - c0, c - c0 + cs).reduce((a, b) => a + b, 0) : 0
      const cpl = mm ? Math.max(3, Math.floor((mm - 2) / 1.8)) : 99
      const lines = textOf(o.content).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0)
      ws.getRow(r).height = Math.max(ws.getRow(r).height || 0, lines * 9 + 5)
    }
    if (cs === 1 && !t.colWidths) {
      const text = typeof t0.value === 'number' ? t0.value.toLocaleString('en-US', { minimumFractionDigits: dec[c] || 0, maximumFractionDigits: Math.max(dec[c] || 0, 3) }) : textOf(t0.value)
      const longest = kind === 'head'
        ? text.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0) * 1.1
        : text.split('\n').reduce((m, l) => Math.max(m, l.length), 0)
      ctx.wmap[c] = Math.max(ctx.wmap[c] || 0, longest * 0.85 + (typeof t0.value === 'number' ? 2.5 : 1.5))
    }
  })
  put(head, 'head'); put(body, 'body'); put(foot, 'foot')

  // ---- what the formula passes read back ----
  const num = (r, c) => { const v = ws.getCell(r, c).value; return typeof v === 'number' ? v : (v && typeof v === 'object' && typeof v.result === 'number' ? v.result : null) }
  const info = { c0, head, headRows: [startRow, bodyStart - 1], numCols, dec, rows: [], next: footStart + (t.foot || []).length, num }
  const allRows = [...new Set([...body, ...foot].map((x) => x.r))].sort((a, b) => a - b)
  for (const r of allRows) info.rows.push({ r, total: rowIsTotal.has(r), label: cellText([...body, ...foot].find((x) => x.r === r && x.c === c0)?.o) })
  info.formulas = applyTableFormulas(ws, info, [...body, ...foot])
  return info
}

const writeF = (ws, r, c, formula, result) => { ws.getCell(r, c).value = { formula, result } }
const near = (a, b, tol = 0.05) => a != null && b != null && Math.abs(a - b) <= tol

// Totals, Beginning + Receipts - Issues and running balances become formulas - but only where the
// formula reproduces the printed figure, so a formula never silently changes what the report says.
const applyTableFormulas = (ws, info, cells) => {
  const { rows, numCols, num, head, c0 } = info
  const applied = { totals: 0, rollforward: 0, running: 0 }
  const dataRows = rows.filter((x) => !x.total)

  // Ending = Beginning + Receipts - Issues, one formula per row
  const grp = (re) => head.find((x) => re.test(cellText(x.o)))
  const gb = grp(/^\s*BEGINNING/i), gr = grp(/^\s*RECEIPTS/i), gi = grp(/^\s*ISSUES/i), ge = grp(/^\s*ENDING/i)
  if (gb && gr && gi && ge && [gr.cs, gi.cs, ge.cs].every((n) => n === gb.cs)) {
    for (const { r } of dataRows) for (let k = 0; k < gb.cs; k++) {
      const [b, rc, is, en] = [gb.c + k, gr.c + k, gi.c + k, ge.c + k].map((c) => num(r, c))
      if ([b, rc, is, en].some((v) => v == null) || !near(b + rc - is, en)) continue
      const ref = (c) => colName(c) + r
      writeF(ws, r, ge.c + k, `${ref(gb.c + k)}+${ref(gr.c + k)}-${ref(gi.c + k)}`, en); applied.rollforward++
    }
  }

  // Running balance: Balance = previous Balance + In - Out
  const balCols = [...numCols].filter((c) => /balance/i.test(head.filter((x) => c >= x.c && c < x.c + x.cs).map((x) => cellText(x.o)).join(' ')) && !(gb && ge))
  if (balCols.length === 1 && dataRows.length >= 3) {
    const bal = balCols[0]
    const others = [...numCols].filter((c) => c !== bal)
    const cand = [null, ...others]
    const val = (r, c) => (c == null ? 0 : (num(r, c) ?? 0))
    outer: for (const a of cand) for (const b of cand) {
      if (a == null && b == null) continue
      let ok = true, moved = false
      for (let i = 1; i < dataRows.length; i++) {
        const prev = num(dataRows[i - 1].r, bal), cur = num(dataRows[i].r, bal)
        if (prev == null || cur == null) { ok = false; break }
        const d = val(dataRows[i].r, a) - val(dataRows[i].r, b)
        if (d !== 0) moved = true
        if (!near(prev + d, cur, 0.011)) { ok = false; break }
      }
      if (ok && moved) {
        for (let i = 1; i < dataRows.length; i++) {
          const r = dataRows[i].r, cur = num(r, bal)
          const parts = [`${colName(bal)}${dataRows[i - 1].r}`]
          if (a != null) parts.push(`+${colName(a)}${r}`)
          if (b != null) parts.push(`-${colName(b)}${r}`)
          writeF(ws, r, bal, parts.join(''), cur); applied.running++
        }
        break outer
      }
    }
  }

  // Row relationships found in the figures themselves (Net = Gross - Deduction, Amount = Kilos x Price ...):
  // a column that equals "A - B" or "A x B" on EVERY row becomes that formula, rounded as printed.
  if (dataRows.length >= 3) {
    const cols = [...numCols].sort((x, y) => x - y)
    for (const T of cols) {
      if ((ge && T >= ge.c && T < ge.c + ge.cs) || /balance/i.test(head.filter((x) => T >= x.c && T < x.c + x.cs).map((x) => cellText(x.o)).join(' '))) continue
      const d = info.dec[T] || 0
      const tol = 0.5 * Math.pow(10, -d) + 1e-9
      let hit = null
      for (const a of cols) {
        if (a >= T || hit) continue
        for (const b of cols) {
          if (b >= T || hit) continue
          // only rows that actually carry all three figures take part (a cancelled row is blank)
          const rowsOK = dataRows.filter((x) => [T, a, b].every((c) => num(x.r, c) != null))
          if (rowsOK.length < 3) continue
          const v = (x, c) => num(x.r, c)
          const flat = (c, k) => rowsOK.every((x) => v(x, c) === k)
          const holds = (f) => rowsOK.every((x) => Math.abs(v(x, T) - f(v(x, a), v(x, b))) <= tol)
          if (a !== b && !flat(b, 0) && !flat(a, 0) && holds((p, q) => p - q)) hit = { op: '-', a, b, rowsOK }
          else if (a < b && !flat(a, 1) && !flat(b, 1) && !flat(a, 0) && !flat(b, 0) && holds((p, q) => p * q)) hit = { op: '*', a, b, rowsOK }
        }
      }
      if (!hit) continue
      hit.rowsOK.forEach((row) => {
        writeF(ws, row.r, T, `ROUND(${colName(hit.a)}${row.r}${hit.op}${colName(hit.b)}${row.r},${d})`, num(row.r, T))
      })
      applied.derived = (applied.derived || 0) + 1
    }
  }

  // Totals: the sum of the rows above (since the previous total), by SUBTOTAL so filtering the sheet re-totals it.
  let segStart = 0
  rows.forEach((row, idx) => {
    if (!row.total) return
    const seg = rows.slice(segStart, idx).filter((x) => !x.total)
    const all = rows.slice(0, idx).filter((x) => !x.total)
    const hadSub = rows.slice(0, idx).some((x) => x.total)
    cells.filter((x) => x.r === row.r && x.cs === 1).forEach(({ c }) => {
      if (!numCols.has(c)) return
      const total = num(row.r, c)
      if (total == null) return
      const sumOf = (list) => list.reduce((s, x) => s + (num(x.r, c) ?? 0), 0)
      const rangeOf = (list) => `${colName(c)}${list[0].r}:${colName(c)}${rows[idx - 1].r}`
      if (seg.length && near(sumOf(seg), total)) { writeF(ws, row.r, c, `SUBTOTAL(9,${colName(c)}${rows[segStart].r}:${colName(c)}${rows[idx - 1].r})`, total); applied.totals++ }
      else if (hadSub && all.length && near(sumOf(all), total)) { writeF(ws, row.r, c, `SUBTOTAL(9,${rangeOf(all)})`, total); applied.totals++ }
    })
    segStart = idx + 1
  })
  return applied
}

const safeSheetName = (s, used) => {
  let n = String(s || 'Report').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Report'
  let k = 2
  const base = n
  while (used.has(n.toLowerCase())) { n = `${base.slice(0, 28)} ${k++}` }
  used.add(n.toLowerCase())
  return n
}

// A sheet is one "page" of the captured report: its title lines, details, headings, tables and signatories.
const groupPages = (capture) => {
  const pages = []
  let cur = null
  for (const rec of capture) {
    if (rec.kind === 'page' || !cur) { cur = { title: rec.kind === 'page' ? rec : { lines: [] }, items: [] }; pages.push(cur); if (rec.kind === 'page') continue }
    cur.items.push(rec)
  }
  return pages
}

const LABEL_LINE = /^([A-Z][A-Z .\/&]{1,28}):\s*(.*)$/

const pageKind = (lines) => {
  const t = lines.join(' ').toUpperCase()
  if (/SUMMARY OF WEEKLY STOCK/.test(t)) return 'summary'
  if (/STATEMENT OF WEEKLY RECEIPTS/.test(t)) return 'st_rec'
  if (/STATEMENT OF WEEKLY ISSUES/.test(t)) return 'st_iss'
  if (/RECAPITULATION OF STOCK RECEIPTS/.test(t)) return 'rc_rec'
  if (/RECAPITULATION OF STOCK ISSUES/.test(t)) return 'rc_iss'
  return 'other'
}
const cerealOf = (h) => (h ? h.text.replace(/^(TYPE OF CEREAL|CEREAL TYPE):\s*/i, '').trim().toUpperCase() : '')

// Signatories laid out as on the printed page: three across (Certified / Verified / Audited), then
// Noted By centred underneath; every name sits on its signature line with the position below it.
const placeSignatures = (ws, startRow, blocks, cumMm, width) => {
  let r = startRow + 1
  const live = (blocks || []).filter((b) => (b.people || []).some((x) => x && (x.name || x.position)) || b.always)
  const total = cumMm[width]
  const bandOf = (k) => {
    const lo = (total * k) / 3, hi = (total * (k + 1)) / 3
    const cols = []
    for (let c = 1; c <= width; c++) { const mid = (cumMm[c - 1] + cumMm[c]) / 2; if (mid >= lo && mid < hi) cols.push(c) }
    if (!cols.length) cols.push(Math.min(width, Math.max(1, Math.round(((k + 0.5) * width) / 3))))
    return [cols[0], cols[cols.length - 1]]
  }
  for (let i = 0; i < live.length; i += 3) {
    const group = live.slice(i, i + 3)
    const slots = group.length === 1 ? [1] : group.map((_, k) => k)
    const merged = (row, k, text, o = {}) => {
      const [c1, c2] = bandOf(k)
      // the signature line stops one column short of the band, leaving the gap between neighbouring lines
      const shortEnough = c2 - c1 >= 2 && cumMm[c2 - 1] - cumMm[c1 - 1] >= 38
      const inner = [c1, (o.line || o.short) && shortEnough ? c2 - 1 : c2]
      if (inner[1] > inner[0]) ws.mergeCells(row, inner[0], row, inner[1])
      const cell = ws.getCell(row, inner[0])
      cell.value = text
      cell.font = { name: FONT, size: 7, ...o.font }
      cell.alignment = { horizontal: o.align || 'center', vertical: 'middle', wrapText: !o.line, shrinkToFit: !!o.line }
      if (o.line) cell.border = { top: { style: 'thin', color: { argb: 'FF000000' } } }
    }
    group.forEach((b, gi) => merged(r, slots[gi], b.role + ':', { align: 'left', font: { color: { argb: 'FF505050' } } }))
    ws.getRow(r).height = 11; r++
    ws.getRow(r).height = 20; r++
    const most = Math.max(...group.map((b) => Math.max(b.people.length, 1)))
    for (let pi = 0; pi < most; pi++) {
      group.forEach((b, gi) => { const x = b.people[pi]; if (x && (x.name || b.always)) merged(r, slots[gi], x.name ? String(x.name).toUpperCase() : '', { line: true, font: { bold: true, size: 8 } }) })
      ws.getRow(r).height = 12; r++
      group.forEach((b, gi) => { const x = b.people[pi]; if (x?.position) merged(r, slots[gi], x.position, { short: true, font: { size: 7 } }) })
      ws.getRow(r).height = 11; r++
      if (pi < most - 1) { ws.getRow(r).height = 10; r++ }
    }
    r++
  }
  return r
}

// A statement's lines, so the summary and recapitulation sheets can total them with SUMIFS across sheets.
const statementIndex = (ws, sheet, info) => {
  const find = (re) => info.head.find((x) => re.test(cellText(x.o)))
  const v = find(/^VARIETY/i), nat = find(/NATURE/i), bags = find(/^BAGS/i), net = find(/^NET/i)
  if (!v || !bags || !net) return null
  const data = info.rows.filter((x) => !x.total)
  if (!data.length) return null
  const lines = data.map((x) => ({
    var: textOf(ws.getCell(x.r, v.c).value).trim().toUpperCase(),
    nat: nat ? textOf(ws.getCell(x.r, nat.c).value).replace(/\s+/g, ' ').trim().toUpperCase() : '',
    bags: info.num(x.r, bags.c) ?? 0, net: info.num(x.r, net.c) ?? 0,
  }))
  const first = data[0].r, last = data[data.length - 1].r
  const rng = (col) => `${quoteSheet(sheet)}!$${colName(col)}$${first}:$${colName(col)}$${last}`
  return { lines, rng, cols: { v: v.c, nat: nat?.c, bags: bags.c, net: net.c } }
}

// Summary receipts/issues and the recapitulations are the statements' lines added up - say so with formulas.
const linkAcrossSheets = (wb, infos) => {
  const stmts = {}
  for (const p of infos) {
    if ((p.kind === 'st_rec' || p.kind === 'st_iss') && p.tables[0]) {
      const idx = statementIndex(p.ws, p.sheet, p.tables[0])
      if (idx) stmts[`${p.kind}|${p.cereal}`] = idx
    }
  }
  const sumifs = (idx, valueCol, crit) => {
    const parts = crit.map(([col, ref]) => `${idx.rng(col)},${ref}`)
    return `SUMIFS(${idx.rng(valueCol)},${parts.join(',')})`
  }
  const expected = (idx, key, crit) => idx.lines.filter((l) => crit.every(([k, val]) => l[k] === val)).reduce((s, l) => s + l[key], 0)
  for (const p of infos) {
    const ws = p.ws
    if (p.kind === 'summary') {
      const t = p.tables[0]
      if (!t) continue
      const gr = t.head.find((x) => /^\s*RECEIPTS/i.test(cellText(x.o))), gi = t.head.find((x) => /^\s*ISSUES/i.test(cellText(x.o)))
      for (const [grp, kind] of [[gr, 'st_rec'], [gi, 'st_iss']]) {
        const idx = stmts[`${kind}|${p.cereal}`]
        if (!grp || !idx || grp.cs < 2) continue
        for (const row of t.rows.filter((x) => !x.total)) {
          const label = textOf(ws.getCell(row.r, t.c0).value).trim().toUpperCase()
          for (let k = 0; k < 2; k++) {
            const col = grp.c + k, key = k === 0 ? 'bags' : 'net'
            const cur = t.num(row.r, col)
            if (cur == null) continue
            if (!near(expected(idx, key, [['var', label]]), cur)) continue
            const f = sumifs(idx, k === 0 ? idx.cols.bags : idx.cols.net, [[idx.cols.v, `$${colName(t.c0)}${row.r}`]])
            writeF(ws, row.r, col, k === 0 ? f : `ROUND(${f},2)`, cur)
          }
        }
      }
    } else if (p.kind === 'rc_rec' || p.kind === 'rc_iss') {
      const idx = stmts[`${p.kind === 'rc_rec' ? 'st_rec' : 'st_iss'}|${p.cereal}`]
      const actTotals = []
      const grandIdx = p.tables.length > 1 && p.tables[p.tables.length - 1].rows.length === 1 ? p.tables.length - 1 : -1
      p.tables.forEach((t, ti) => {
        if (ti === grandIdx) return
        const act = p.activities[ti]
        const bagsH = t.head.find((x) => /^BAGS/i.test(cellText(x.o))), netH = t.head.find((x) => /^NET/i.test(cellText(x.o)))
        if (act && idx && idx.cols.nat && bagsH && netH) {
          for (const row of t.rows.filter((x) => !x.total)) {
            const label = textOf(ws.getCell(row.r, t.c0).value).trim().toUpperCase()
            for (const [h, key, vc] of [[bagsH, 'bags', idx.cols.bags], [netH, 'net', idx.cols.net]]) {
              const cur = t.num(row.r, h.c)
              if (cur == null) continue
              if (!near(expected(idx, key, [['nat', act], ['var', label]]), cur)) continue
              const f = sumifs(idx, vc, [[idx.cols.nat, `"${act}"`], [idx.cols.v, `$${colName(t.c0)}${row.r}`]])
              writeF(ws, row.r, h.c, key === 'net' ? `ROUND(${f},2)` : f, cur)
            }
          }
        }
        const tot = t.rows.find((x) => x.total)
        if (tot && act) actTotals.push({ r: tot.r, t })
      })
      // the grand TOTAL block adds up each activity's total
      const last = grandIdx >= 0 ? p.tables[grandIdx] : null
      const grand = last && last.rows.find((x) => x.total)
      if (grand && actTotals.length) {
        for (const x of last.head) {
          if (!/^(BAGS|NET)/i.test(cellText(x.o))) continue
          const c = x.c, cur = last.num(grand.r, c)
          const sum = actTotals.reduce((s, a) => s + (a.t.num(a.r, c) ?? 0), 0)
          if (cur != null && near(sum, cur)) writeF(ws, grand.r, c, actTotals.map((a) => `${colName(c)}${a.r}`).join('+'), cur)
        }
      }
    }
  }
}

/** Builds a workbook from a generator's capture array: one sheet per captured page. */
export const captureToWorkbook = async (capture, { sheetName = 'Report' } = {}) => {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.calcProperties = { fullCalcOnLoad: true }
  const used = new Set()
  const pages = groupPages(capture)
  const infos = []
  pages.forEach((p) => {
    const heading = p.items.find((i) => i.kind === 'h')
    const base = (p.title.sheet || p.title.lines[p.title.lines.length > 2 ? 2 : p.title.lines.length - 1] || sheetName)
    const cereal = heading ? heading.text.replace(/^(TYPE OF CEREAL|CEREAL TYPE):\s*(LOCAL\s+)?/i, '') : ''
    const sheet = safeSheetName(`${base}${cereal ? ' ' + cereal : ''}`, used)
    const ws = wb.addWorksheet(sheet, { views: [{ state: 'normal', showGridLines: false }] })
    const tables = p.items.filter((i) => i.kind === 'table')
    // canvas: the table's own columns, plus a left spacer when the table is indented on the printed page
    const indent = tables.length && tables.every((t) => t.colWidths && t.startX - PAGE_MARGIN_MM > 3) ? Math.min(...tables.map((t) => t.startX)) - PAGE_MARGIN_MM : 0
    const off = indent ? 1 : 0
    const ncols = Math.max(0, ...tables.map((t) => Math.max(t.colWidths?.length ?? 0, tableWidth(t))))
    const width = Math.max(4, off + ncols)
    const ctx = { off, wmap: {} }
    let r = 1
    const full = (text, opt = {}) => {
      ws.mergeCells(r, 1, r, width)
      const c = ws.getCell(r, 1)
      c.value = text
      c.font = { name: FONT, bold: !!opt.bold, size: opt.size || 8, italic: !!opt.italic, color: opt.muted ? { argb: 'FF505050' } : undefined }
      c.alignment = { horizontal: opt.align || 'center', vertical: 'middle' }
      ws.getRow(r).height = (opt.size || 8) * 1.45 + 1
      r++
    }
    const lines = p.title.lines
    lines.forEach((l, i) => {
      if (lines.length >= 5) {
        const last = i === lines.length - 1
        full(l, { bold: !(i === 2 || last), size: i === 0 ? 11 : i === 1 ? 9 : i === 2 || last ? 8 : 10 })
      } else full(l, { bold: i < lines.length - 1, size: i === 0 ? 11 : 9 })
    })
    if (lines.length) { ws.getRow(r).height = 8; r++ }

    // label width for the REGION / PROVINCE / CODE / WHSE block = 22 mm of the printed page
    const mmCols = []
    const firstW = tables.find((t) => t.colWidths)
    for (let c = 1; c <= width; c++) mmCols[c] = c <= off ? indent : (firstW ? (firstW.colWidths[c - 1 - off] ?? 12) : null)
    let labelEnd = 1
    if (firstW) { let acc = indent * 0; for (let c = 1; c <= width; c++) { acc += mmCols[c] ?? 0; labelEnd = c; if (acc >= 22) break } }

    const kinds = pageKind(lines)
    const info = { kind: kinds, sheet, ws, cereal: cerealOf(heading), tables: [], activities: [] }
    let lastActivity = null
    for (let ix = 0; ix < p.items.length; ix++) {
      const it = p.items[ix]
      if (it.kind === 'info') {
        it.lines.forEach((l) => {
          const m = LABEL_LINE.exec(l)
          if (m && firstW) {
            if (labelEnd > 1) ws.mergeCells(r, 1, r, labelEnd)
            const a = ws.getCell(r, 1), b = ws.getCell(r, labelEnd + 1)
            a.value = m[1] + ':'; a.font = { name: FONT, size: 8 }; a.alignment = { horizontal: 'left', vertical: 'middle' }
            if (width > labelEnd + 1) ws.mergeCells(r, labelEnd + 1, r, width)
            b.value = m[2]; b.font = { name: FONT, size: 8, bold: true }; b.alignment = { horizontal: 'left', vertical: 'middle' }
            ws.getRow(r).height = 11; r++
          } else if (m) {
            const a = ws.getCell(r, 1), b = ws.getCell(r, 2)
            a.value = m[1] + ':'; a.font = { name: FONT, size: 8 }
            b.value = m[2]; b.font = { name: FONT, size: 8, bold: true }; b.alignment = { horizontal: 'left', wrapText: false }
            ctx.wmap[1] = Math.max(ctx.wmap[1] || 0, m[1].length * 0.85 + 3)
            r++
          } else full(l, { align: 'left' })
        })
        ws.getRow(r).height = 8; r++
      } else if (it.kind === 'h') {
        if (/^ACTIVITY:/i.test(it.text)) lastActivity = it.text.replace(/^ACTIVITY:\s*/i, '').trim().toUpperCase()
        full(it.text, { bold: true, align: 'left' })
      } else if (it.kind === 'table') {
        const t = placeTable(ws, r, it, ctx)
        info.tables.push(t); info.activities.push(lastActivity)
        r = t.next; ws.getRow(r).height = 8; r++
      } else if (it.kind === 'sign') {
        r = placeSignatures(ws, r, it.blocks, cumulative(width, mmCols, ctx.wmap), width)
      } else if (it.kind === 'kv') {
        // as printed: the reconciliation sits at the right, beside the signatories on the left
        const nxt = p.items[ix + 1]
        const cum = cumulative(width, mmCols, ctx.wmap)
        const total = cum[width]
        let left = width - 1
        while (left > 1 && total - cum[left] < 78) left--
        const first = left + 1
        let valueFrom = width
        while (valueFrom > first + 1 && cum[width] - cum[valueFrom - 1] < 26) valueFrom--
        let kr = r
        for (const [label, value, bold] of it.rows) {
          if (valueFrom - 1 > first) ws.mergeCells(kr, first, kr, valueFrom - 1)
          if (width > valueFrom) ws.mergeCells(kr, valueFrom, kr, width)
          const a = ws.getCell(kr, first), b = ws.getCell(kr, valueFrom), v = asCell(value)
          a.value = label; b.value = v.value; if (v.numFmt) b.numFmt = v.numFmt
          a.font = b.font = { name: FONT, size: 8.5, bold: !!bold }
          a.alignment = { horizontal: 'left', vertical: 'middle' }
          b.alignment = { horizontal: 'right', vertical: 'middle' }
          for (let c = first; c <= width; c++) {
            const cc = ws.getCell(kr, c)
            cc.border = { bottom: { style: 'thin', color: { argb: bold ? 'FF000000' : 'FFC8C8C8' } } }
            if (bold) cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } }
          }
          ws.getRow(kr).height = 14
          kr++
        }
        let sr = r
        if (nxt && nxt.kind === 'sign') { sr = placeSignatures(ws, r, nxt.blocks, cum, left); ix++ }
        r = Math.max(kr, sr)
      }
    }
    for (let c = 1; c <= width; c++) {
      const chars = mmCols[c] != null ? mmToChars(mmCols[c]) : Math.min(46, Math.max(7, Math.ceil(ctx.wmap[c] || 0) + 1))
      ws.getColumn(c).width = chars
    }
    const geo = tables.find((t) => t.pageW)
    const landscape = geo ? geo.pageW > geo.pageH : tables.some((t) => tableWidth(t) > 9)
    ws.pageSetup = {
      paperSize: 9, orientation: landscape ? 'landscape' : 'portrait',
      fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: PAGE_MARGIN_MM / 25.4, right: PAGE_MARGIN_MM / 25.4, top: 0.55, bottom: 0.6, header: 0.3, footer: 0.3 },
    }
    ws.headerFooter = { oddFooter: '&C&"Arial,Regular"&7Page &P of &N' }
    if (info.tables[0]) ws.pageSetup.printTitlesRow = `${info.tables[0].headRows[0]}:${info.tables[0].headRows[1]}`
    infos.push(info)
  })
  linkAcrossSheets(wb, infos)
  if (!pages.length) wb.addWorksheet(sheetName)
  return wb
}

const tableWidth = (t) => {
  const widest = (rows) => rows.reduce((m, row) => Math.max(m, row.reduce((a, c) => a + ((c && c.colSpan) || 1), 0)), 0)
  return Math.max(widest(t.head || []), widest(t.body || []), widest(t.foot || []), 1)
}

// cumulative printed width (mm) at each column boundary, for placing the signature bands
const cumulative = (width, mmCols, wmap) => {
  const out = [0]
  for (let c = 1; c <= width; c++) out.push(out[c - 1] + (mmCols[c] != null ? mmCols[c] : charsToMm(Math.min(46, Math.max(7, Math.ceil(wmap[c] || 0) + 1)))))
  return out
}

export const exportCaptureToExcel = async (capture, { fileName, sheetName }) => {
  const wb = await captureToWorkbook(capture, { sheetName })
  await download(wb, fileName)
}

/** Pile Layout: the floor plan laid out like the printed page (landscape, one box per pile, label left /
 *  figure right), with the figures in each box linked to a "Pile Data" sheet so editing a pile updates the plan. */
export const exportPileLayoutToExcel = async ({ warehouse, periodFrom, periodTo, gridCols, gridRows, boxes, signatories = {}, fileName }) => {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.calcProperties = { fullCalcOnLoad: true }
  const ws = wb.addWorksheet('Pile Layout', { views: [{ state: 'normal', showGridLines: false }] })
  const data = wb.addWorksheet('Pile Data', { views: [{ state: 'normal', showGridLines: false }] })
  const cols = Math.max(gridCols || 1, 1), rows = Math.max(gridRows || 1, 1)
  const fmtD = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
  const thinBlack = { style: 'thin', color: { argb: 'FF000000' } }
  const grayRule = { style: 'thin', color: { argb: 'FF787878' } }
  const FILL = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

  // ---------- Pile Data sheet: one row per pile, then one row per stock group of a multi-group pile ----------
  const placed = boxes.filter((b) => b.pile)
  const pileRow = new Map(), groupRows = new Map()
  const head = (row, labels) => labels.forEach((t, i) => {
    const c = data.getCell(row, i + 1)
    c.value = t
    c.font = { name: FONT, size: 8, bold: true }
    c.fill = FILL(HEAD_FILL)
    c.border = headBorder
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  const body = (row, vals, fmts = {}) => vals.forEach((v, i) => {
    const c = data.getCell(row, i + 1)
    c.value = v
    c.font = { name: FONT, size: 8 }
    c.border = bodyBorder
    if (fmts[i]) { c.numFmt = fmts[i]; c.alignment = { horizontal: 'right' } }
  })
  data.getCell(1, 1).value = `${warehouse?.name ?? ''} - PILE DATA`
  data.getCell(1, 1).font = { name: FONT, size: 11, bold: true }
  data.getCell(2, 1).value = 'The Pile Layout sheet reads these figures; change a pile here and its box updates.'
  data.getCell(2, 1).font = { name: FONT, size: 8, italic: true, color: { argb: 'FF666666' } }
  head(4, ['Pile', 'Cereal', 'Variety', 'Condition', 'Bags', 'Net Kg', 'Age', 'Row', 'Column'])
  const multi = placed.filter((b) => (b.groupRows?.length ?? 0) > 1)
  const firstPile = 5
  const groupHead = firstPile + placed.length + 3
  let gr = groupHead + 1
  multi.forEach((b) => { groupRows.set(b.id, b.groupRows.map(() => gr++)) })
  const groupFirst = groupHead + 1, groupLast = gr - 1
  placed.forEach((b, i) => {
    const r = firstPile + i
    pileRow.set(b.id, r)
    const isMulti = (b.groupRows?.length ?? 0) > 1
    body(r, [b.pile.pileName, b.pile.cerealType ?? '', b.variety?.name ?? '', b.pile.condition ?? '',
      isMulti ? { formula: `SUMIFS($C$${groupFirst}:$C$${groupLast},$A$${groupFirst}:$A$${groupLast},A${r})`, result: b.groupRows.reduce((s, x) => s + (x.bags || 0), 0) } : (b.pile.currentBags ?? 0),
      isMulti ? { formula: `ROUND(SUMIFS($D$${groupFirst}:$D$${groupLast},$A$${groupFirst}:$A$${groupLast},A${r}),3)`, result: b.groupRows.reduce((s, x) => s + (x.kilos || 0), 0) } : (b.pile.currentKilos ?? 0),
      b.pile.formattedAge ?? '', b.rowStart, b.colStart], { 4: '#,##0', 5: '#,##0.000' })
  })
  const totalRow = firstPile + placed.length
  if (placed.length) {
    const tl = data.getCell(totalRow, 1)
    tl.value = 'TOTAL'; tl.font = { name: FONT, size: 8, bold: true }
    for (const [c, f, fmt, key] of [[5, 'E', '#,##0', 'currentBags'], [6, 'F', '#,##0.000', 'currentKilos']]) {
      const cell = data.getCell(totalRow, c)
      const result = placed.reduce((s, b) => s + (b.groupRows?.length > 1 ? b.groupRows.reduce((t, x) => t + (c === 5 ? x.bags : x.kilos || 0), 0) : (b.pile[key] ?? 0)), 0)
      cell.value = { formula: `SUBTOTAL(9,${f}${firstPile}:${f}${totalRow - 1})`, result }
      cell.numFmt = fmt; cell.font = { name: FONT, size: 8, bold: true }; cell.alignment = { horizontal: 'right' }
    }
    for (let c = 1; c <= 9; c++) { data.getCell(totalRow, c).border = bodyBorder; data.getCell(totalRow, c).fill = FILL('FFEEEEEE') }
  }
  if (multi.length) {
    data.getCell(groupHead - 1, 1).value = 'Stock groups of piles holding more than one'
    data.getCell(groupHead - 1, 1).font = { name: FONT, size: 8, bold: true }
    head(groupHead, ['Pile', 'Group', 'Bags', 'Net Kg'])
    multi.forEach((b) => b.groupRows.forEach((g, i) => {
      body(groupRows.get(b.id)[i], [b.pile.pileName, groupHeading(g), g.bags ?? 0, g.kilos ?? 0], { 2: '#,##0', 3: '#,##0.000' })
    }))
  }
  ;[16, 12, 14, 12, 12, 16, 18, 7, 8].forEach((w, i) => { data.getColumn(i + 1).width = w })
  data.getColumn(2).width = 26
  data.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }

  // ---------- Pile Layout sheet geometry (printed mm -> Excel) ----------
  const PAGE_W = 297, PAGE_H = 210, M = 12, INSET = 4
  const outerW = PAGE_W - M * 2
  const gridStartY = 14 + 5 + (warehouse?.address ? 5 : 0) + 3 + 6 + 6
  const outerH = PAGE_H - gridStartY - 38 - M
  const cellW = (outerW - INSET * 2) / cols
  const cellH = (outerH - INSET * 2) / rows

  // how many sheet rows a box needs: its name, one per printed line, and a spare row for breathing room
  const need = (b) => 2 + (b.entries ?? []).filter((e) => e.kind !== 'rule').length
  const k = Math.max(2, ...boxes.map((b) => Math.ceil(need(b) / Math.max(b.rowSpan, 1))))
  const subH = Math.max(9, (cellH / k) * 2.835)

  const CW = 2 * cols + 2                                  // inset | label,value per grid column | inset
  ws.getColumn(1).width = mmToChars(INSET)
  for (let c = 0; c < cols * 2; c++) ws.getColumn(c + 2).width = mmToChars(cellW / 2)
  ws.getColumn(CW).width = mmToChars(INSET)
  // outer margin columns: the sheet starts at the page margin, so no extra column is needed for it

  let r = 1
  const full = (text, o = {}) => {
    ws.mergeCells(r, 1, r, CW)
    const c = ws.getCell(r, 1)
    c.value = text
    c.font = { name: FONT, size: o.size || 8, bold: !!o.bold, color: o.color ? { argb: o.color } : undefined }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(r).height = (o.size || 8) * 1.5 + 1
    r++
  }
  full((warehouse?.name ?? '').toUpperCase(), { size: 11, bold: true })
  if (warehouse?.address) full(warehouse.address.toUpperCase(), { size: 8 })
  ws.getRow(r).height = 8; r++
  full('PILE LAYOUT', { size: 14, bold: true })
  full(`As of ${fmtD(periodFrom)} - ${fmtD(periodTo)}`, { size: 8 })
  ws.getRow(r).height = 8; r++

  // outer boundary: an inset row/column of white around the grid, framed by one rectangle
  const frameTop = r
  ws.getRow(r).height = INSET * 2.835; r++
  const gridTop = r
  for (let i = 0; i < rows * k; i++) { ws.getRow(r + i).height = subH }
  r += rows * k
  ws.getRow(r).height = INSET * 2.835
  const frameBottom = r
  r++
  const edge = (row, c, side) => {
    const cell = ws.getCell(row, c)
    cell.border = { ...(cell.border || {}), [side]: { style: 'medium', color: { argb: 'FF000000' } } }
  }
  for (let c = 1; c <= CW; c++) { edge(frameTop, c, 'top'); edge(frameBottom, c, 'bottom') }
  for (let row = frameTop; row <= frameBottom; row++) { edge(row, 1, 'left'); edge(row, CW, 'right') }

  // ---------- the boxes ----------
  const fillOf = (b) => (!b.pile ? 'FFFFFFFF' : b.variety?.category === 'Palay' ? 'FFADEBB3' : b.variety?.category === 'By Products' ? 'FFFBEBCC' : 'FFB8E3E9')
  for (const b of boxes) {
    const c1 = 2 + (b.colStart - 1) * 2, c2 = c1 + b.colSpan * 2 - 1, mid = c1 + Math.max(1, Math.round(b.colSpan * 2 * (b.colSpan <= 3 ? 0.5 : 0.4))) - 1
    const rowTop = gridTop + (b.rowStart - 1) * k, nRows = Math.max(b.rowSpan, 1) * k
    const fill = FILL(fillOf(b))
    const entries = (b.entries ?? []).filter(Boolean)
    const lines = entries.filter((e) => e.kind !== 'rule').length
    const used = 1 + (b.pile ? lines : 1)
    const lead = Math.max(0, Math.floor((nRows - used) / 2))
    // what each row of the box shows
    const plan = Array.from({ length: nRows }, () => ({ type: 'blank' }))
    let at = lead
    plan[at++] = { type: 'name' }
    if (!b.pile) plan[at++] = { type: 'vacant' }
    else {
      let ruleNext = false, gi = -1
      for (const e of entries) {
        if (e.kind === 'rule') { ruleNext = true; continue }
        if (at >= nRows) break
        if (e.kind === 'heading') { gi++; plan[at++] = { type: 'heading', e, rule: ruleNext } }
        else plan[at++] = { type: 'field', e, rule: ruleNext, gi }
        ruleNext = false
      }
    }
    const isMulti = (b.groupRows?.length ?? 0) > 1
    plan.forEach((p, i) => {
      const row = rowTop + i, first = i === 0, last = i === nRows - 1
      const bdr = (side) => (side === 'top' ? first : side === 'bottom' ? last : true)
      const mergedBorder = (extra = {}) => ({
        ...(first ? { top: thinBlack } : {}), ...(last ? { bottom: thinBlack } : {}), ...extra,
      })
      if (p.type === 'field') {
        if (mid > c1) ws.mergeCells(row, c1, row, mid)
        if (c2 > mid + 1) ws.mergeCells(row, mid + 1, row, c2)
        const a = ws.getCell(row, c1), v = ws.getCell(row, mid + 1)
        a.value = `${p.e.label}:`
        a.font = { name: FONT, size: 7, bold: p.e.bold, color: { argb: p.e.bold ? 'FF000000' : 'FF505050' } }
        a.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
        a.fill = fill
        a.border = mergedBorder({ left: thinBlack, ...(p.rule ? { top: grayRule } : {}) })
        v.fill = fill
        v.border = mergedBorder({ right: thinBlack, ...(p.rule ? { top: grayRule } : {}) })
        v.font = { name: FONT, size: 7, bold: p.e.bold }
        v.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 }
        const raw = p.e.raw
        if (raw && b.pile) {
          const pr = pileRow.get(b.id)
          const col = raw.t === 'bags' ? 'E' : 'F'
          const ref = isMulti && !raw.total
            ? `'Pile Data'!${raw.t === 'bags' ? 'C' : 'D'}${groupRows.get(b.id)[p.gi]}`
            : `'Pile Data'!${col}${pr}`
          v.value = { formula: ref, result: raw.n ?? 0 }
          v.numFmt = raw.t === 'bags' ? '#,##0' : '#,##0.000'
        } else v.value = String(p.e.value ?? '')
        return
      }
      if (c2 > c1) ws.mergeCells(row, c1, row, c2)
      const cell = ws.getCell(row, c1)
      cell.fill = fill
      cell.border = mergedBorder({ left: thinBlack, right: thinBlack, ...(p.rule ? { top: grayRule } : {}) })
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      if (p.type === 'name') {
        cell.value = b.pile?.pileName ?? b.label ?? ''
        cell.font = { name: FONT, size: 10, bold: true }
        cell.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: true }
        if (!b.pile) cell.value = b.label ?? ''
        ws.getRow(row).height = Math.max(ws.getRow(row).height || 0, 13)
      } else if (p.type === 'vacant') {
        cell.value = 'VACANT'
        cell.font = { name: FONT, size: 7, color: { argb: 'FF505050' } }
      } else if (p.type === 'heading') {
        cell.value = p.e.aside ? { richText: [{ text: p.e.text, font: { name: FONT, size: 7, bold: true } }, { text: ` · ${p.e.aside}`, font: { name: FONT, size: 6, color: { argb: 'FF505050' } } }] } : p.e.text
        cell.font = { name: FONT, size: 7, bold: true }
        cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
      }
      void bdr
    })
  }

  // ---------- signatories: Prepared by | Verified Correct | Certified Correct | Noted by ----------
  r++
  const sig = [
    ['Prepared by:', signatories.preparedByName, 'Classifier'],
    ['Verified Correct:', signatories.verifiedCorrect?.name, signatories.verifiedCorrect?.position],
    ['Certified Correct:', signatories.certifiedCorrectName, signatories.certifiedCorrectPosition],
    ['Noted by:', signatories.notedByName, signatories.notedByPosition],
  ]
  const per = Math.floor((CW - 2) / 4)
  const span = (i) => [2 + i * per, i === 3 ? CW - 1 : 1 + (i + 1) * per]
  const sigRow = (height, fn) => {
    sig.forEach((s, i) => {
      const [a, z] = span(i)
      const end = fn.line && z - a >= 2 ? z - 1 : z
      if (end > a) ws.mergeCells(r, a, r, end)
      const cell = ws.getCell(r, a)
      fn.set(cell, s)
      if (fn.line) cell.border = { top: thinBlack }
    })
    ws.getRow(r).height = height
    r++
  }
  sigRow(11, { set: (c, s) => { c.value = s[0]; c.font = { name: FONT, size: 7, color: { argb: 'FF505050' } }; c.alignment = { horizontal: 'left', vertical: 'middle' } } })
  ws.getRow(r).height = 24; r++
  sigRow(13, { line: true, set: (c, s) => { c.value = String(s[1] ?? '').toUpperCase(); c.font = { name: FONT, size: 8, bold: true }; c.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: true } } })
  sigRow(11, { set: (c, s) => { c.value = s[2] ?? ''; c.font = { name: FONT, size: 7 }; c.alignment = { horizontal: 'center', vertical: 'middle' } } })
  r++
  full(`BSM by ArVee - ${new Date().toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })}`, { size: 6, color: 'FFA0A0A0' })

  ws.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true,
    margins: { left: M / 25.4, right: M / 25.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  }
  await download(wb, fileName)
}

/** Saves a finished report either as the PDF or as Excel (built from the captured content). */
export const saveReport = async ({ doc, capture, kind, baseName, sheetName }) => {
  if (kind === 'excel') await exportCaptureToExcel(capture, { fileName: `${baseName}.xlsx`, sheetName })
  else doc.save(`${baseName}.pdf`)
}
