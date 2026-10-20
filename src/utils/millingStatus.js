// Milling status report (Stock Desk > Milling and Issuances > "Milling status", Admin only) - READ-ONLY, pure functions.
// The status sheet of the on-going milling operations: one row per milling authority of a private ricemill dated in the period,
// grouped by ricemill, in the layout of the office's own table:
//   Lot No. | Pile No. | Issuing Warehouse | Name of Ricemill | QTY (net bags) | GMR | Expected Rice Recovery | Receiving Whse
// plus two columns that table did not have:
//   Total issuance  = net bags actually issued so far against the authority (its WSIs)
//   Balance / % issued = authorized vs issued: what is still to be issued, and how much of the authorization is issued
//   Remarks         = the last issuance, in net bags, with its date
// QTY is what the authority authorizes (net kilos / 50); GMR and the receiving warehouse come from the MO (milling order) that
// carries the same authority number; Expected Rice Recovery = QTY x GMR.

import { millerKey } from './millingLiquidation.js'

const NET_BAG_KG = 50
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
const bagsOf = (kilos) => (kilos ?? 0) / NET_BAG_KG
const pileNo = (name) => String(name ?? '').replace(/^pile\s*/i, '').trim()

/**
 * @param issues        the private milling rows of buildMillingIssuances (data.milling.issues)
 * @param transactions  all transactions (WSIs are looked up by authority number)
 * @param piles         all piles (for the pile number)
 * @param millingOrders the synced MO / TMO records (GMR = recoveryPercent, receivingWarehouse)
 */
export const buildMillingStatus = ({ issues, transactions = [], piles = [], millingOrders = [] }) => {
  const pileById = new Map(piles.map((p) => [p.pileId, p]))
  const wsiByAi = new Map()
  for (const t of transactions) {
    if (t.type !== 'WSI' || t.status !== 'Active' || !t.aiNumber) continue
    const list = wsiByAi.get(t.aiNumber) ?? []
    list.push(t)
    wsiByAi.set(t.aiNumber, list)
  }
  const ordersByAi = new Map()
  for (const o of millingOrders) {
    if (!o.aiNumber) continue
    const list = ordersByAi.get(o.aiNumber) ?? []
    list.push(o)
    ordersByAi.set(o.aiNumber, list)
  }

  const rows = issues.map((r) => {
    const orders = ordersByAi.get(r.aiNumber) ?? []
    const order = orders.find((o) => millerKey(o.ricemillName) === millerKey(r.customer)) ?? orders[0] ?? null
    const gmr = order?.recoveryPercent != null && Number.isFinite(Number(order.recoveryPercent)) ? Number(order.recoveryPercent) : null
    const wsis = (wsiByAi.get(r.aiNumber) ?? []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0)))
    const issuedBags = wsis.length > 0 ? wsis.reduce((s, t) => s + bagsOf(t.netKilos), 0) : r.withdrawn
    const last = wsis.at(-1) ?? null
    const pilesText = [...new Set(wsis.map((t) => pileNo(pileById.get(t.pileId)?.pileName)).filter(Boolean))].sort(natural).join(', ')
    return {
      id: r.id, date: r.date, aiNumber: r.aiNumber, pile: pilesText, warehouse: r.warehouse, miller: r.customer,
      qty: r.bags, gmr, expected: gmr != null ? r.bags * (gmr / 100) : null,
      receiving: order?.receivingWarehouse ?? '',
      issued: issuedBags, balance: r.bags - issuedBags, pctIssued: r.bags > 0 ? (issuedBags / r.bags) * 100 : null,
      lastBags: last ? bagsOf(last.netKilos) : null, lastDate: last?.date ?? null,
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
  const totalOf = (list) => {
    const qty = sum(list, 'qty')
    const issued = sum(list, 'issued')
    return { qty, expected: sum(list, 'expected'), issued, balance: qty - issued, pctIssued: qty > 0 ? (issued / qty) * 100 : null }
  }
  let lot = 0
  const out = [...groups.values()].sort((a, b) => natural(a.miller, b.miller)).map((g) => {
    g.rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : natural(a.aiNumber, b.aiNumber)))
    g.rows.forEach((r) => { lot += 1; r.lot = lot })
    return { ...g, total: totalOf(g.rows) }
  })
  const all = out.flatMap((g) => g.rows)
  return { groups: out, total: totalOf(all), rows: all }
}

const n2 = (n) => (n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const remarksText = (r) => {
  if (r.lastBags == null) return 'No issuance yet'
  const d = r.lastDate ? new Date(`${r.lastDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
  return `Last issuance: ${n2(r.lastBags)} bags${d ? ` (${d})` : ''}`
}

/** Tab-separated, pastes into a Sheet or Excel with the same columns. A group with two or more rows ends with a Total row. */
export const millingStatusText = (data) => {
  const head = ['Lot No.', 'Pile No.', 'Issuing Warehouse', 'Name of Ricemill', 'QTY (bags of 50kg)', 'GMR', 'Expected Rice Recovery', 'RECEIVING Whse', 'Total issuance (bags)', 'Balance (bags)', '% issued', 'Remarks']
  const lines = [head.join('\t')]
  for (const g of data.groups) {
    for (const r of g.rows) lines.push([r.lot, r.pile, r.warehouse, r.miller, n2(r.qty), r.gmr == null ? '' : `${n2(r.gmr)}%`, n2(r.expected), r.receiving, n2(r.issued), n2(r.balance), r.pctIssued == null ? '' : `${n2(r.pctIssued)}%`, remarksText(r)].join('\t'))
    if (g.rows.length >= 2) lines.push(['', '', 'Total', '', n2(g.total.qty), '', n2(g.total.expected), '', n2(g.total.issued), n2(g.total.balance), g.total.pctIssued == null ? '' : `${n2(g.total.pctIssued)}%`, ''].join('\t'))
  }
  lines.push(['', '', 'Grand total', '', n2(data.total.qty), '', n2(data.total.expected), '', n2(data.total.issued), n2(data.total.balance), data.total.pctIssued == null ? '' : `${n2(data.total.pctIssued)}%`, ''].join('\t'))
  return lines.join('\n')
}
