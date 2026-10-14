// Milling and Issuances (Stock Desk, Admin only) - READ-ONLY, pure functions.
//
// Three groups, every figure in net bags (net kilos / 50) and totalled per province:
//  - Milling: the palay issued to milling (WSI with an MO / TMO number, listed per authority) and the
//    rice recovered from it (WSR with an MO / TMO number, listed per WSR; rice only, no by-products).
//  - Issuances to LGU: WSI from an authority, transaction type SALES, customer name containing "LGU".
//  - Issuances to FTI: WSI from an authority, transaction type SALES (CONSIGNMENT).
// A warehouse's reporting start (override) date is respected like everywhere else: documents dated on
// or before it are left out.

import { effectiveCutoffDate } from './calculations.js'

const NET_BAG_KG = 50
const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })

export const netBags = (kilos) => (kilos ?? 0) / NET_BAG_KG

export const buildMillingIssuances = ({ transactions, warehouses, provinces, varieties, transactionTypes, globalDataStartDate = null, from, to }) => {
  const whById = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const provById = new Map(provinces.map((p) => [p.provinceId, p]))
  const varById = new Map(varieties.map((v) => [v.varietyId, v]))
  const typeName = new Map(transactionTypes.map((t) => [t.transactionTypeId, norm(t.name)]))

  const row = (t) => {
    const wh = whById.get(t.warehouseId)
    const prov = provById.get(wh?.provinceId)
    return {
      id: t.id, date: t.date, serialNo: t.serialNo ?? '', provinceId: wh?.provinceId ?? '', province: prov?.name ?? 'No province',
      warehouse: wh?.name ?? '', customer: t.customerName ?? '', aiNumber: t.aiNumber ?? '', kind: t.moNumber ? 'MO' : t.tmoNumber ? 'TMO' : '',
      moNo: t.moNumber ?? t.tmoNumber ?? '', kilos: t.netKilos ?? 0, bags: netBags(t.netKilos), variety: varById.get(t.varietyId)?.name ?? '',
    }
  }

  const milling = { issues: [], recoveries: [] }
  const lgu = []
  const fti = []

  for (const t of transactions) {
    if (t.status !== 'Active' || !['WSI', 'WSR'].includes(t.type) || t.isInitialBalance) continue
    if (t.date < from || t.date > to) continue
    const wh = whById.get(t.warehouseId)
    const cut = effectiveCutoffDate(wh?.reportingCutoffDate, globalDataStartDate)
    if (cut && t.date <= cut) continue
    const milled = Boolean(t.moNumber || t.tmoNumber)
    if (t.type === 'WSR') {
      if (milled && varById.get(t.varietyId)?.category === 'Rice') milling.recoveries.push(row(t))
      continue
    }
    if (milled) { milling.issues.push(row(t)); continue }
    if (!t.aiNumber) continue
    const type = typeName.get(t.transactionTypeId)
    if (type === 'SALES' && /LGU/i.test(t.customerName ?? '')) lgu.push(row(t))
    else if (type === 'SALES (CONSIGNMENT)') fti.push(row(t))
  }

  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : natural(a.serialNo, b.serialNo))
  for (const l of [milling.issues, milling.recoveries, lgu, fti]) l.sort(byDate)

  // per-province totals, in the order of the provinces' names
  const perProvince = (lists) => {
    const m = new Map()
    for (const [key, list] of Object.entries(lists)) {
      for (const r of list) {
        const e = m.get(r.province) ?? { province: r.province }
        e[key] = (e[key] ?? 0) + r.bags
        m.set(r.province, e)
      }
    }
    return [...m.values()].sort((a, b) => natural(a.province, b.province))
  }
  const sum = (list) => list.reduce((s, r) => s + r.bags, 0)

  // milling issues grouped per authority (then per province), recoveries stay one row per WSR
  const authorities = new Map()
  for (const r of milling.issues) {
    const key = r.aiNumber || 'No authority'
    const e = authorities.get(key) ?? { aiNumber: key, bags: 0, rows: [] }
    e.bags += r.bags
    e.rows.push(r)
    authorities.set(key, e)
  }

  return {
    milling: {
      perProvince: perProvince({ issued: milling.issues, recovered: milling.recoveries }),
      issuedTotal: sum(milling.issues), recoveredTotal: sum(milling.recoveries),
      issues: milling.issues, recoveries: milling.recoveries,
      perAuthority: [...authorities.values()].sort((a, b) => natural(a.aiNumber, b.aiNumber)),
    },
    lgu: { perProvince: perProvince({ bags: lgu }), total: sum(lgu), rows: lgu },
    fti: { perProvince: perProvince({ bags: fti }), total: sum(fti), rows: fti },
  }
}
