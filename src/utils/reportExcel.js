// Excel versions of the printed reports (Stock Report, BIN Card, Pile Layout, SDO Abstract,
// CPF Cash Disbursement Record).
//
// Each report's PDF generator records what it prints (see pdfCapture.js); this file turns
// that record into a workbook, so the Excel file always shows the same rows and totals as
// the PDF. The spreadsheet library is imported only when Export is tapped. Read-only: the
// file is built in memory and downloaded; nothing in the app's data is touched.

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
    if (kind === 'head') wc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } }
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
  const total = cumMm[cumMm.length - 1]
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
      const inner = [c1, o.line && c2 - c1 >= 2 ? c2 - 1 : c2]
      if (inner[1] > inner[0]) ws.mergeCells(row, inner[0], row, inner[1])
      const cell = ws.getCell(row, inner[0])
      cell.value = text
      cell.font = { name: FONT, size: 7, ...o.font }
      cell.alignment = { horizontal: o.align || 'center', vertical: 'middle', wrapText: true }
      if (o.line) cell.border = { top: { style: 'thin', color: { argb: 'FF000000' } } }
    }
    group.forEach((b, gi) => merged(r, slots[gi], b.role + ':', { align: 'left', font: { color: { argb: 'FF505050' } } }))
    ws.getRow(r).height = 11; r++
    ws.getRow(r).height = 20; r++
    const most = Math.max(...group.map((b) => Math.max(b.people.length, 1)))
    for (let pi = 0; pi < most; pi++) {
      group.forEach((b, gi) => { const x = b.people[pi]; if (x && (x.name || b.always)) merged(r, slots[gi], x.name ? String(x.name).toUpperCase() : '', { line: true, font: { bold: true, size: 8 } }) })
      ws.getRow(r).height = 12; r++
      group.forEach((b, gi) => { const x = b.people[pi]; if (x?.position) merged(r, slots[gi], x.position, { font: { size: 7 } }) })
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
    for (const it of p.items) {
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
        for (const [label, value, bold] of it.rows) {
          const a = ws.getCell(r, 1), b = ws.getCell(r, 2), v = asCell(value)
          a.value = label; b.value = v.value; if (v.numFmt) b.numFmt = v.numFmt
          a.font = b.font = { name: FONT, size: 8, bold: !!bold }
          b.alignment = { horizontal: 'right' }
          ctx.wmap[1] = Math.max(ctx.wmap[1] || 0, String(label).length * 0.85 + 2)
          ctx.wmap[2] = Math.max(ctx.wmap[2] || 0, String(value).length * 0.9 + 3)
          r++
        }
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

/** Pile Layout: the floor plan as a grid of merged cells (one per pile box), plus a plain list of every pile. */
export const exportPileLayoutToExcel = async ({ warehouse, branch, periodFrom, periodTo, gridCols, gridRows, boxes, fmtBags, fmtKilos, fileName }) => {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Layout')
  const cols = Math.max(gridCols || 1, 1), rows = Math.max(gridRows || 1, 1)
  const lines = ['NATIONAL FOOD AUTHORITY', branch?.name, warehouse?.name, 'PILE LAYOUT', `As of ${periodFrom} - ${periodTo}`].filter(Boolean)
  lines.forEach((l, i) => {
    ws.mergeCells(i + 1, 1, i + 1, Math.max(cols, 4))
    const c = ws.getCell(i + 1, 1)
    c.value = l
    c.font = { bold: i < 4, size: i === 0 ? 13 : 11 }
    c.alignment = { horizontal: 'center' }
  })
  const top = lines.length + 2
  for (let c = 1; c <= cols; c++) ws.getColumn(c).width = 18
  for (let r = 0; r < rows; r++) ws.getRow(top + r).height = 46
  const text = (box) => {
    if (!box.pile) return `${box.label ?? ''}\nVACANT`.trim()
    const p = box.pile
    const rowsOf = box.groupRows ?? []
    const parts = [p.pileName]
    if (box.variety?.name) parts.push(`Var: ${box.variety.name}`)
    if (rowsOf.length > 1) rowsOf.forEach((g) => parts.push(`${g.varietyName ?? g.sackLabelText ?? 'Stock'}: ${fmtBags(g.bags)} bags / ${fmtKilos(g.kilos)} kg`))
    else parts.push(`${fmtBags(p.currentBags)} bags / ${fmtKilos(p.currentKilos)} kg`)
    if (p.formattedAge) parts.push(`Age: ${p.formattedAge}`)
    return parts.join('\n')
  }
  for (const box of boxes) {
    const r1 = top + box.rowStart - 1, c1 = box.colStart, r2 = r1 + box.rowSpan - 1, c2 = c1 + box.colSpan - 1
    if (r2 > r1 || c2 > c1) ws.mergeCells(r1, c1, r2, c2)
    const cell = ws.getCell(r1, c1)
    cell.value = text(box)
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
    cell.font = { size: 9, color: { argb: box.pile ? 'FF000000' : 'FF888888' } }
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } }
    if (box.pile) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F4EA' } }
  }
  const list = wb.addWorksheet('Piles')
  const head = ['Pile', 'Cereal', 'Variety', 'Bags', 'Net kg', 'Age', 'Row', 'Column']
  list.addRow(head).font = { bold: true }
  for (const b of boxes.filter((x) => x.pile)) {
    list.addRow([b.pile.pileName, b.pile.cerealType ?? '', b.variety?.name ?? '', b.pile.currentBags ?? '', b.pile.currentKilos ?? '', b.pile.formattedAge ?? '', b.rowStart, b.colStart])
  }
  list.getColumn(4).numFmt = '#,##0'; list.getColumn(5).numFmt = '#,##0.000'
  ;[18, 12, 18, 10, 14, 14, 8, 8].forEach((w, i) => { list.getColumn(i + 1).width = w })
  await download(wb, fileName)
}

/** Saves a finished report either as the PDF or as Excel (built from the captured content). */
export const saveReport = async ({ doc, capture, kind, baseName, sheetName }) => {
  if (kind === 'excel') await exportCaptureToExcel(capture, { fileName: `${baseName}.xlsx`, sheetName })
  else doc.save(`${baseName}.pdf`)
}
