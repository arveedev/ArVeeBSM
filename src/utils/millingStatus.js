// Milling status report (Stock Desk > Milling and Issuances > "Milling status", Admin only) - READ-ONLY, pure functions.
// The office's own status table of the on-going milling operations, one row per LOT, grouped by ricemill:
//   Lot No. | Pile No. | Issuing Warehouse | Name of Ricemill | QTY (bag of 50kg) | GMR | Expected Rice Recovery | RECEIVING Whse
// and two added columns: Total issued, and Remarks (the as-of date of the total and the last issuance).
//
// How a lot is read from the app: a milling authority (AI) is one TRANCHE of a lot. Its note is written "<issued so far> / <QTY of the lot>"
// (for example "6000 / 7205.05", or "KINALE 3B 500 / 6263.35" with the warehouse and pile in front). The number after the slash is the QTY
// authorized to be issued to the miller for the whole lot; the number before it is the total issued up to that tranche. So:
//   QTY            = the number after the slash (never changed, never a sum of tranches)
//   Total issued   = the number before the slash of the latest tranche (as of that tranche's date)
//   Last issuance  = the net bags that latest tranche authorizes (its own amount)
// GMR and the receiving warehouse come from the MO (milling order) that carries one of the lot's authority numbers; expected rice recovery =
// QTY x GMR. Lot No. is NOT in the data: the Admin types it once per lot in the table (it is never the row count). Pile No. is read from the
// note or the withdrawal slips, and can be overridden the same way.

import { millerKey } from './millingLiquidation.js'

const NET_BAG_KG = 50
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
const num = (s) => Number(String(s).replace(/,/g, ''))
const pileNo = (name) => String(name ?? '').replace(/^pile\s*/i, '').replace(/^dryer\s*/i, 'D').trim() // "Pile 4B" -> 4B, "Dryer 2" -> D2 (as the office writes them)
// "TAB GID A" -> "TAB GID" (a trailing single letter marks a lettered variant of the same warehouse)
const baseWarehouse = (name) => String(name ?? '').replace(/^[A-Z]{2,6}-/, '').replace(/\s[A-Z]$/, '').trim()

/** "6000 / 7205.05" -> { issued: 6000, qty: 7205.05, pile: '' };  "KINALE 3B 500 / 6263.35" -> { issued: 500, qty: 6263.35, pile: '3B' }; otherwise null. */
export const parseLotNote = (note) => {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*\/\s*(\d[\d,]*(?:\.\d+)?)/.exec(String(note ?? ''))
  if (!m) return null
  const qty = num(m[2])
  if (!(qty > 0)) return null
  const prefix = String(note).slice(0, m.index).trim()
  const last = prefix.split(/\s+/).pop() ?? ''
  return { issued: num(m[1]), qty, pile: /^\d+[A-Za-z]?$/.test(last) ? last.toUpperCase() : '' }
}

export const lotKey = (miller, qty) => `${millerKey(miller)}|${qty.toFixed(2)}`

/**
 * @param issues        the private milling rows of buildMillingIssuances (data.milling.issues; each has note, source, aiNumber, date, bags, customer)
 * @param transactions  all transactions (WSIs give a pile when the note has none)
 * @param piles         all piles
 * @param millingOrders the synced MO / TMO records (GMR = recoveryPercent, receivingWarehouse)
 * @param lotInfo       { [lotKey]: { lotNo, pile } } typed by the Admin
 */
export const buildMillingStatus = ({ issues, transactions = [], piles = [], millingOrders = [], lotInfo = {} }) => {
  const pileById = new Map(piles.map((p) => [p.pileId, p]))
  const pilesByAi = new Map()
  for (const t of transactions) {
    if (t.type !== 'WSI' || t.status !== 'Active' || !t.aiNumber) continue
    const list = pilesByAi.get(t.aiNumber) ?? new Set()
    const p = pileNo(pileById.get(t.pileId)?.pileName)
    if (p) list.add(p)
    pilesByAi.set(t.aiNumber, list)
  }
  const orderByAi = new Map(millingOrders.filter((o) => o.aiNumber).map((o) => [o.aiNumber, o]))

  const lots = new Map()
  const unassigned = []
  for (const r of issues) {
    const p = parseLotNote(r.note)
    if (!p) { unassigned.push({ aiNumber: r.aiNumber, miller: r.customer, date: r.date, bags: r.bags, note: r.note ?? '' }); continue }
    const key = lotKey(r.customer, p.qty)
    const lot = lots.get(key) ?? { key, miller: r.customer, qty: p.qty, tranches: [] }
    lot.tranches.push({ ...r, issuedTo: p.issued, notePile: p.pile })
    lots.set(key, lot)
  }

  const rows = [...lots.values()].map((lot) => {
    const t = lot.tranches.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.issuedTo - b.issuedTo || natural(a.aiNumber, b.aiNumber)))
    const last = t.at(-1)
    const order = t.map((x) => orderByAi.get(x.aiNumber)).find(Boolean) ?? null
    const gmr = order?.recoveryPercent != null && Number.isFinite(Number(order.recoveryPercent)) ? Number(order.recoveryPercent) : null
    const notePile = [...new Set(t.map((x) => x.notePile).filter(Boolean))].sort(natural).join(', ')
    const slipPile = [...new Set(t.flatMap((x) => [...(pilesByAi.get(x.aiNumber) ?? [])]))].sort(natural).join(', ')
    const info = lotInfo[lot.key] ?? {}
    return {
      key: lot.key, lotNo: info.lotNo ?? '', pile: info.pile ?? (notePile || slipPile),
      warehouse: [...new Set(t.map((x) => baseWarehouse(x.source || x.warehouse)).filter(Boolean))].join(' / '),
      miller: lot.miller, qty: lot.qty, gmr, expected: gmr != null ? lot.qty * (gmr / 100) : null,
      receiving: order?.receivingWarehouse ?? '',
      totalIssued: last.issuedTo, asOf: last.date, lastBags: last.bags, tranches: t.length, aiNumbers: t.map((x) => x.aiNumber),
    }
  })

  const groups = new Map()
  for (const r of rows) {
    const k = millerKey(r.miller)
    const g = groups.get(k) ?? { key: k, miller: r.miller, rows: [] }
    g.rows.push(r)
    groups.set(k, g)
  }
  const sum = (list, key) => list.reduce((s, r) => s + (r[key] ?? 0), 0)
  const totalOf = (list) => ({ qty: sum(list, 'qty'), expected: list.some((r) => r.expected != null) ? sum(list, 'expected') : null, issued: sum(list, 'totalIssued') })
  // lots in the order of their number when typed, otherwise by the QTY (stable); ricemills A-Z like the office table
  const out = [...groups.values()].sort((a, b) => natural(a.miller, b.miller)).map((g) => {
    g.rows.sort((a, b) => (a.lotNo !== '' && b.lotNo !== '' ? natural(a.lotNo, b.lotNo) : 0) || natural(a.pile, b.pile) || a.qty - b.qty)
    return { ...g, total: totalOf(g.rows) }
  })
  const all = out.flatMap((g) => g.rows)
  return { groups: out, total: totalOf(all), rows: all, unassigned }
}

const n2 = (n) => (n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const dateText = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '')

/** Remarks: the as-of date of the total issued, and the last issuance in net bags. */
export const remarksText = (r) => `As of ${dateText(r.asOf)}; last issuance ${n2(r.lastBags)} net bags`

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
