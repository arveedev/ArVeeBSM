// Milling status report (Stock Desk > Milling and Issuances > "Milling status", Admin only) - READ-ONLY, pure functions.
//
// The office's own status table of the on-going milling operations:
//   Lot No. | Pile No. | Issuing Warehouse | Name of Ricemill | QTY (bag of 50kg) | GMR | Expected Rice Recovery | RECEIVING Whse
// IS the table: its rows (lot, pile, warehouse, ricemill, QTY, GMR, receiving warehouse) are kept exactly as the office wrote them, in
// `reportConfig.millingStatusTable` (the Admin edits it in the screen); it starts as the office's table of October 2026 (DEFAULT_MILLING_TABLE).
// Expected Rice Recovery = QTY x GMR (checked against every row of the office's table). Nothing in those columns is worked out from other data.
//
// The app only adds two columns:
//   Total issued = the "issued so far" the milling authorities report for that lot, as of the period's last day
//   Remarks      = the date of that total (as of) and the last batch issued (the net bags of that latest tranche)
// How a lot is found among the authorities: each milling authority (AI) is one tranche of a lot and its note reads "<issued so far> / <QTY>"
// (for example "6000 / 7205.05", or "KINALE 3B 500 / 6263.35"). A tranche belongs to the table row of the same ricemill whose QTY equals the
// number after the slash; the number before it, on the latest tranche up to the period's last day, is the lot's total issued. A row with no
// tranche yet shows nothing in the two added columns.

import { millerKey } from './millingLiquidation.js'

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
const num = (s) => Number(String(s).replace(/,/g, ''))
// "TAB GID A" -> "TAB GID" (a trailing single letter marks a lettered variant of the same warehouse)
const baseWarehouse = (name) => String(name ?? '').replace(/^[A-Z]{2,6}-/, '').replace(/\s[A-Z]$/, '').trim()
const titleWord = (w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())

/** The office's short name: "Dens Marketing Corporation", "MAGAYON RM", "Borromeo Ricemill" -> Dens, Magayon, Borromeo. */
export const shortMiller = (name) => {
  const cleaned = String(name ?? '').replace(/\b(rice\s*mill|ricemill|rm|marketing|corporation|corp|enterprises|trading|inc)\b\.?/gi, ' ').replace(/\s+/g, ' ').trim()
  return (cleaned || String(name ?? '').trim()).split(' ').map(titleWord).join(' ')
}
export const shortWarehouse = (name) => baseWarehouse(name).split(' ').filter(Boolean).map(titleWord).join(' ')

/** The office's table (October 2026), row for row. */
export const DEFAULT_MILLING_TABLE = [
  { lotNo: '1', pile: '1', warehouse: 'Tabaco GID', miller: 'Borromeo', qty: 6124.18, gmr: 63.27, receiving: 'Abacorp/ Leg Gid' },
  { lotNo: '2', pile: '2', warehouse: 'Tabaco GID', miller: 'Borromeo', qty: 6482.15, gmr: 64.84, receiving: 'Abacorp/ Leg Gid' },
  { lotNo: '8', pile: '4B', warehouse: 'BSI', miller: 'Borromeo', qty: 424.32, gmr: 63.68, receiving: 'Leg GID' },
  { lotNo: '9', pile: '3', warehouse: 'Kinale', miller: 'Borromeo', qty: 6879.0, gmr: 63.36, receiving: 'Leg GID/ VRT' },
  { lotNo: '10', pile: '2', warehouse: 'Kinale', miller: 'Borromeo', qty: 4183.74, gmr: 64.1, receiving: 'LegGID/VRT' },
  { lotNo: '3', pile: '4', warehouse: 'Tabaco GID', miller: 'Kipshoven', qty: 4996.96, gmr: 64.13, receiving: 'Abacorp' },
  { lotNo: '11', pile: '3B', warehouse: 'Kinale', miller: 'Kipshoven', qty: 6263.35, gmr: 65.04, receiving: 'Leg GID/VRT' },
  { lotNo: '13', pile: '2', warehouse: 'VRT', miller: 'Kipshoven', qty: 2981.29, gmr: 64.09, receiving: 'Leg GID / VRT' },
  { lotNo: '4', pile: '3', warehouse: 'Tabaco GID', miller: 'Buama', qty: 5394.16, gmr: 64.92, receiving: 'Abacorp' },
  { lotNo: '5', pile: '5', warehouse: 'Tabaco GID', miller: 'Buama', qty: 9546.43, gmr: 64.84, receiving: 'Abacorp' },
  { lotNo: '6', pile: 'D1', warehouse: 'BSI', miller: 'Dens', qty: 15693.87, gmr: 64.37, receiving: 'Leg GID/ VRT' },
  { lotNo: '12', pile: '1A', warehouse: 'Kinale', miller: 'Dens', qty: 4012.57, gmr: 64.35, receiving: 'Leg GID/ VRT' },
  { lotNo: '7', pile: 'D2', warehouse: 'BSI', miller: 'Magayon', qty: 7205.05, gmr: 64.3, receiving: 'Abacorp/ Leg Gid' },
]

/** "6000 / 7205.05" -> { issued: 6000, qty: 7205.05 };  "KINALE 3B 500 / 6263.35" -> { issued: 500, qty: 6263.35 }; otherwise null. */
export const parseLotNote = (note) => {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*\/\s*(\d[\d,]*(?:\.\d+)?)/.exec(String(note ?? ''))
  if (!m) return null
  const qty = num(m[2])
  return qty > 0 ? { issued: num(m[1]), qty } : null
}

const sameMiller = (a, b) => shortMiller(a).toLowerCase() === shortMiller(b).toLowerCase() || millerKey(a) === millerKey(b)

/**
 * @param table   the office's table rows (DEFAULT_MILLING_TABLE or what the Admin saved)
 * @param issues  the private milling authorities up to the period's last day (rows of buildMillingIssuances: note, customer, date, aiNumber)
 * @param to      the period's last day (the total issued is as of this day)
 */
export const buildMillingStatus = ({ table = DEFAULT_MILLING_TABLE, issues = [], to = '9999-12-31' }) => {
  const tranches = []
  for (const r of issues) {
    if (r.date > to) continue
    const p = parseLotNote(r.note)
    if (p) tranches.push({ miller: r.customer, date: r.date, issued: p.issued, qty: p.qty, aiNumber: r.aiNumber, bags: r.bags })
  }
  const rows = table.map((t, i) => {
    const qty = Number(t.qty) || 0
    const gmr = t.gmr === '' || t.gmr == null || !Number.isFinite(Number(t.gmr)) ? null : Number(t.gmr)
    const mine = tranches.filter((x) => Math.abs(x.qty - qty) < 0.005 && sameMiller(x.miller, t.miller))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.issued - b.issued || natural(a.aiNumber, b.aiNumber)))
    const last = mine.at(-1) ?? null
    return {
      index: i, lotNo: t.lotNo ?? '', pile: t.pile ?? '', warehouse: t.warehouse ?? '', miller: t.miller ?? '', qty, gmr,
      expected: gmr != null ? qty * (gmr / 100) : null, receiving: t.receiving ?? '',
      totalIssued: last ? last.issued : null, asOf: last ? last.date : null, lastBatch: last ? last.bags : null,
    }
  })
  // blocks of consecutive rows of the same ricemill, in the table's own order
  const groups = []
  for (const r of rows) {
    const g = groups.at(-1)
    if (g && g.miller.toLowerCase() === r.miller.toLowerCase()) g.rows.push(r)
    else groups.push({ key: `${r.miller}-${r.index}`, miller: r.miller, rows: [r] })
  }
  const sum = (list, key) => list.reduce((s, r) => s + (r[key] ?? 0), 0)
  const any = (list, key) => list.some((r) => r[key] != null)
  const totalOf = (list) => ({ qty: sum(list, 'qty'), expected: any(list, 'expected') ? sum(list, 'expected') : null, issued: any(list, 'totalIssued') ? sum(list, 'totalIssued') : null })
  return { groups: groups.map((g) => ({ ...g, total: totalOf(g.rows) })), rows, total: totalOf(rows) }
}

const n2 = (n) => (n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const dateText = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '')

/** Remarks: the as-of date of the total issued and the last batch issued, in net bags (nothing for a row with no issuance yet). */
export const remarksText = (r) => (r.asOf ? `As of ${dateText(r.asOf)}; last batch issued ${n2(r.lastBatch)} bags` : '')

/** Tab-separated, pastes into a Sheet or Excel with the same columns. A group with two or more rows ends with a Total row. */
export const millingStatusText = (data) => {
  const head = ['Lot No.', 'Pile No.', 'Issuing Warehouse', 'Name of Ricemill', 'QTY (bag of 50kg)', 'GMR', 'Expected Rice Recovery', 'RECEIVING Whse', 'Total issued (net bags)', 'Remarks']
  const lines = [head.join('\t')]
  for (const g of data.groups) {
    for (const r of g.rows) lines.push([r.lotNo, r.pile, r.warehouse, r.miller, n2(r.qty), r.gmr == null ? '' : `${n2(r.gmr)}%`, n2(r.expected), r.receiving, n2(r.totalIssued), remarksText(r)].join('\t'))
    if (g.rows.length >= 2) lines.push(['', '', 'Total', '', n2(g.total.qty), '', n2(g.total.expected), '', n2(g.total.issued), ''].join('\t'))
  }
  return lines.join('\n')
}
