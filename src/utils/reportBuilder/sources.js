// Report Builder: the data sources. READ-ONLY: this module only reads tables (toArray) and the Stock Desk's own pure builders and
// returns plain rows. It has no write path. Names are resolved (warehouse, province, variety, user ...), secrets are never offered
// (see isDenied in fields.js), and a staff member's rows are cut to their own warehouses here, before anything reaches the screen.

import { db } from '../../db/dexie.js'
import { inferFields, N, D, T } from './fields.js'
import { makeContext, buildSummary, buildLedger, buildAgeLists } from '../inventoryReport.js'
import { buildMillingIssuances } from '../millingIssuances.js'
import { parseLotNote } from '../millingStatus.js'
import { applyPeriod, clampPeriod } from './engine.js'

const NET_BAG_KG = 50
const WIDE = ['Admin', 'Analyst']
export const isWideRole = (role) => WIDE.includes(role)

// ------------------------------------------------------------------------------------------------ helpers
const scalars = (rec) => {
  const o = {}
  for (const [k, v] of Object.entries(rec ?? {})) if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) o[k] = v
  return o
}
const iso = (n) => (typeof n === 'number' && n > 1.2e12 ? new Date(n).toISOString().slice(0, 16).replace('T', ' ') : n ?? '')

async function lookups() {
  const [warehouses, provinces, varieties, types, users, piles, sacks, branches] = await Promise.all([
    db.warehouses.toArray(), db.provinces.toArray(), db.varietyTypes.toArray(), db.transactionTypes.toArray(), db.users.toArray(), db.piles.toArray(), db.sackTypes.toArray(), db.branches.toArray(),
  ])
  const wh = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const prov = new Map(provinces.map((p) => [p.provinceId, p]))
  const variety = new Map(varieties.map((v) => [v.varietyId, v]))
  const type = new Map(types.map((t) => [t.transactionTypeId, t]))
  const user = new Map(users.map((u) => [u.uid, u]))
  const pile = new Map(piles.map((p) => [p.pileId, p]))
  const sack = new Map(sacks.map((s) => [s.sackTypeId, s]))
  const branch = new Map(branches.map((b) => [b.branchId, b]))
  const place = (id) => {
    const w = wh.get(id)
    const p = prov.get(w?.provinceId)
    return { warehouse: w?.name ?? '', warehouseShort: (w?.name ?? '').replace(/^[A-Z]{2,6}[\s-]+/, ''), warehouseCode: w?.code ?? '', province: p?.name ?? '', facility: w?.facilityType ?? (w ? 'Warehouse' : ''), __wh: id ?? null }
  }
  return { warehouses, provinces, varieties, types, users, piles, sacks, wh, prov, variety, type, user, pile, sack, branch, place, name: (map, id, key = 'name') => map.get(id)?.[key] ?? '' }
}

/** Put the named fields first (in that order), the rest after, alphabetically. */
const ordered = (fields, first = [], hide = []) => {
  const byId = new Map(fields.map((f) => [f.id, f]))
  const head = first.filter((id) => byId.has(id)).map((id) => byId.get(id))
  const rest = fields.filter((f) => !first.includes(f.id) && !hide.includes(f.id)).sort((a, b) => a.label.localeCompare(b.label))
  return [...head, ...rest]
}
const build = (rows, overrides, first, hide = []) => { const fields = ordered(inferFields(rows, overrides), first, hide); return { rows, fields, main: first.filter((id) => fields.some((f) => f.id === id)) } }
const cut = (rows, allowed) => (allowed ? rows.filter((r) => r.__wh == null || allowed.has(r.__wh)) : rows)
const cutStrict = (rows, allowed) => (allowed ? rows.filter((r) => r.__wh != null && allowed.has(r.__wh)) : rows)

// Raw foreign keys are hidden in favour of the resolved names.
const FK = ['warehouseId', 'pileId', 'varietyId', 'transactionTypeId', 'sdoUid', 'sackTypeId', 'issuedPileId', 'receivedPileId', 'issuedVarietyId', 'receivedVarietyId', 'issuedSackTypeId', 'receivedSackTypeId', 'mtsSackTypeId', 'createdByUid', 'voidedByUid', 'editedByUid', 'provinceId', 'branchId', 'id', 'prId', 'authId', 'itemId', 'orderId', 'cutoffId', 'customerId', 'wsrTransactionId', 'sourceId']
const L = (label, kind) => ({ label, kind })

// ------------------------------------------------------------------------------------------------ source definitions
// access: 'all' = every role that may use the Builder; 'wide' = Admin and Analyst only. scoped: rows carry __wh and a staff member's are cut.
export const SOURCES = [
  { id: 'docs', dateField: 'date', group: 'Documents', name: 'Documents (WSR, WSI, WTS, ESR, ESI)', access: 'all', scoped: true, load: async ({ allowed }) => {
    const [tx, lk, prs] = await Promise.all([db.transactions.toArray(), lookups(), db.purchaseReceipts.toArray()])
    // the Purchase Receipt (SDO side) that paid a WSR; a cancelled one only counts when there is no other
    const prBy = new Map()
    for (const p of prs) { if (!p.wsrTransactionId) continue; const c = prBy.get(p.wsrTransactionId); if (!c || (c.status === 'Cancelled' && p.status !== 'Cancelled')) prBy.set(p.wsrTransactionId, p) }
    const rows = tx.map((t) => {
      const v = lk.variety.get(t.varietyId)
      const pr = prBy.get(t.id)
      return {
        ...scalars(t), ...lk.place(t.warehouseId),
        transactionType: lk.name(lk.type, t.transactionTypeId), cereal: v?.category ?? t.cerealCategory ?? '', variety: v?.name ?? t.varietyNameRaw ?? '',
        pile: lk.name(lk.pile, t.pileId, 'pileName'), issuedPile: lk.name(lk.pile, t.issuedPileId, 'pileName'), receivedPile: lk.name(lk.pile, t.receivedPileId, 'pileName'),
        issuedVariety: lk.name(lk.variety, t.issuedVarietyId), receivedVariety: lk.name(lk.variety, t.receivedVarietyId),
        netBags: typeof t.netKilos === 'number' ? t.netKilos / NET_BAG_KG : null, createdAt: iso(t.createdAt), authorityAckAt: iso(t.authorityAckAt),
        farmerMembers: Array.isArray(t.farmerCoops) ? t.farmerCoops.length : 0, sackLinesCount: Array.isArray(t.sackLines) ? t.sackLines.length : 0,
        prNo: pr?.prNo ?? '', prDate: pr?.date ?? '', prAmount: pr ? (pr.totalAmount ?? 0) : null, prUnitCost: pr?.unitCost ?? null, prPayment: pr?.paymentMethod ?? '', prCheckNo: pr?.checkNumber ?? '', prStatus: pr?.status ?? '', prSdo: pr ? lk.name(lk.user, pr.sdoUid) : '',
      }
    })
    return build(cut(rows, allowed), {
      date: L('Date'), serialNo: L('Serial no.'), type: L('Document'), transactionType: L('Transaction type'), status: L('Status'), warehouse: L('Warehouse'), warehouseCode: L('Warehouse code'),
      province: L('Province'), facility: L('Facility type'), pile: L('Pile'), cereal: L('Cereal'), variety: L('Variety'), customerName: L('Farmer / customer'), aiNumber: L('Authority no. (AI)'),
      siaNumber: L('Authority no. (SIA)'), moNumber: L('MO'), tmoNumber: L('TMO'), numberOfBags: L('Bags'), grossKilos: L('Gross kg'), netKilos: L('Net kg'), netBags: L('Net bags'),
      createdByName: L('Entered by'), recordedByName: L('Recorded by'), editedBy: L('Edited by'), mts: L('MTS'), moistureContent: L('Moisture %'),
      prNo: L('PR no.'), prDate: L('PR date'), prAmount: L('Amount paid (PHP)'), prUnitCost: L('PR unit cost'), prPayment: L('Payment method'), prCheckNo: L('Check no.'), prStatus: L('PR status'), prSdo: L('Disbursing officer'),
      ...Object.fromEntries(FK.map((k) => [k, { hide: true }])),
    }, ['date', 'serialNo', 'type', 'transactionType', 'status', 'warehouse', 'province', 'pile', 'cereal', 'variety', 'customerName', 'aiNumber', 'moNumber', 'numberOfBags', 'netKilos', 'netBags', 'prNo', 'prAmount', 'createdByName'])
  } },
  { id: 'docs_sacks', dateField: 'date', group: 'Documents', name: 'Sack lines (ESR and ESI, one row per sack type)', access: 'all', scoped: true, load: async ({ allowed }) => {
    const [tx, lk] = await Promise.all([db.transactions.toArray(), lookups()])
    const rows = []
    for (const t of tx) for (const s of Array.isArray(t.sackLines) ? t.sackLines : []) rows.push({ date: t.date, serialNo: t.serialNo, type: t.type, status: t.status, ...lk.place(t.warehouseId), customerName: t.customerName ?? '', sackType: lk.name(lk.sack, s.sackTypeId, 'code'), cereal: lk.sack.get(s.sackTypeId)?.category ?? '', condition: s.condition ?? '', pieces: s.pieces ?? 0, siaNumber: t.siaNumber ?? '', createdByName: t.createdByName ?? '' })
    return build(cut(rows, allowed), { serialNo: L('Serial no.'), type: L('Document'), customerName: L('Customer'), sackType: L('Sack type'), siaNumber: L('Authority no. (SIA)'), createdByName: L('Entered by') }, ['date', 'serialNo', 'type', 'status', 'warehouse', 'province', 'cereal', 'sackType', 'condition', 'pieces'])
  } },
  { id: 'auth', dateField: 'date', group: 'Authorities and milling', name: 'Authorities (AI and SIA)', access: 'all', scoped: true, load: async ({ allowed }) => {
    const [au, lk] = await Promise.all([db.authorities.toArray(), lookups()])
    const rows = au.map((a) => {
      const lot = parseLotNote(a.note1)
      return {
        ...scalars(a), ...lk.place(a.assignedWarehouse), variety: lk.name(lk.variety, a.varietyId),
        // the cereal type: an AI by its variety; an SIA by the sack types it authorizes (Palay, Rice, By Products)
        cereal: a.type === 'AI' ? (lk.variety.get(a.varietyId)?.category ?? '') : [...new Set((Array.isArray(a.sackLines) ? a.sackLines : []).map((l) => lk.sack.get(l.sackTypeId)?.category).filter(Boolean))].join(' / '),
        sackTypes: [...new Set((Array.isArray(a.sackLines) ? a.sackLines : []).map((l) => lk.name(lk.sack, l.sackTypeId, 'code')).filter(Boolean))].join(', '),
        balanceBags: (a.totalAllocationBags ?? (a.totalAllocationKilos ?? 0) / NET_BAG_KG) - (a.totalIssuedBags ?? (a.totalIssuedKilos ?? 0) / NET_BAG_KG),
        balanceKilos: (a.totalAllocationKilos ?? 0) - (a.totalIssuedKilos ?? 0), allocationNetBags: (a.totalAllocationKilos ?? 0) / NET_BAG_KG, issuedNetBags: (a.totalIssuedKilos ?? 0) / NET_BAG_KG,
        lotQty: lot ? lot.qty : null, lotIssuedSoFar: lot ? lot.issued : null, firstSeenAt: a.firstSeenAt ?? '', changes: Array.isArray(a.changeLog) ? a.changeLog.length : 0,
      }
    })
    return build(cut(rows, allowed), {
      type: L('Type'), aiNumber: L('AI no.'), siaNumber: L('SIA no.'), customerName: L('Customer'), transactionTypeName: L('Transaction type'), regionalAuthorityNumber: L('Regional authority no.'), totalAllocationBags: L('Authorized bags'), totalAllocationKilos: L('Authorized kg'),
      totalIssuedBags: L('Issued bags'), totalIssuedKilos: L('Issued kg'), balanceBags: L('Balance bags'), balanceKilos: L('Balance kg'), allocationNetBags: L('Authorized net bags'), issuedNetBags: L('Issued net bags'), lotQty: L('Lot QTY (from the note)'), lotIssuedSoFar: L('Lot issued so far (from the note)'),
      note1: L('Note 1'), note2: L('Note 2'), assignedWarehouse: { hide: true }, ...Object.fromEntries(FK.map((k) => [k, { hide: true }])),
    }, ['date', 'aiNumber', 'siaNumber', 'type', 'transactionTypeName', 'customerName', 'warehouse', 'cereal', 'variety', 'sackTypes', 'totalAllocationBags', 'totalIssuedBags', 'balanceBags', 'status', 'regionalAuthorityNumber', 'ageGroup'])
  } },
  { id: 'auth_sacks', dateField: 'date', group: 'Authorities and milling', name: 'Authority sack lines (SIA)', access: 'all', scoped: true, load: async ({ allowed }) => {
    const [au, lk] = await Promise.all([db.authorities.toArray(), lookups()])
    const rows = []
    for (const a of au) for (const s of Array.isArray(a.sackLines) ? a.sackLines : []) rows.push({ date: a.date ?? '', siaNumber: a.siaNumber ?? '', customer: a.customerName ?? '', status: a.status ?? '', ...lk.place(a.assignedWarehouse), sackType: lk.name(lk.sack, s.sackTypeId, 'code') || s.sackTypeCode || '', cereal: lk.sack.get(s.sackTypeId)?.category ?? '', condition: s.condition ?? '', authorizedPieces: s.pieces ?? s.allocation ?? 0, issuedPieces: s.issued ?? 0 })
    return build(cut(rows, allowed), { siaNumber: L('SIA no.') }, ['date', 'siaNumber', 'customer', 'warehouse', 'cereal', 'sackType', 'condition', 'authorizedPieces', 'issuedPieces', 'status'])
  } },
  { id: 'mo', dateField: 'dateOfMilling', group: 'Authorities and milling', name: 'Milling orders (MO and TMO)', access: 'all', scoped: true, load: async ({ allowed }) => {
    const [mo, done, lk] = await Promise.all([db.millingOrders.toArray(), db.millingOrderCompletions.toArray(), lookups()])
    const doneBy = new Map(done.map((d) => [d.orderId, d]))
    const nm = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const mine = allowed ? new Set([...allowed].map((id) => nm(lk.name(lk.wh, id)))) : null
    const rows = mo.filter((o) => !mine || mine.has(nm(o.receivingWarehouse))).map((o) => ({ ...scalars(o), completedInApp: doneBy.get(o.orderId)?.completed ? 'Yes' : 'No', completedAt: iso(doneBy.get(o.orderId)?.updatedAt) }))
    return build(rows, { type: L('Type'), number: L('Control no.'), ricemillName: L('Ricemill'), recoveryPercent: L('GMR %'), receivingWarehouse: L('Receiving warehouse'), dateOfMilling: L('Date of milling'), aiNumber: L('AI no.'), siaNumber: L('SIA no.'), orderId: { hide: true } }, ['type', 'number', 'ricemillName', 'recoveryPercent', 'receivingWarehouse', 'aiNumber', 'dateOfMilling', 'batchRaw', 'sheetStatus', 'completedInApp'])
  } },
  { id: 'ricemill', group: 'Authorities and milling', name: 'Ricemill allocations (NFA-owned and private)', access: 'wide', load: async () => {
    const [a, b, c] = await Promise.all([db.ricemillAllocations.toArray(), db.privateMillerAllocations.toArray(), db.privateMillerShares.toArray()])
    const rows = [
      ...a.map((r) => ({ kind: 'NFA-owned ricemill', ricemill: '', ...scalars(r) })),
      ...b.map((r) => ({ kind: 'Private miller allocation', ...scalars(r) })),
      ...c.map((r) => ({ kind: 'Private miller share', ...scalars(r) })),
    ]
    return build(rows, { kind: L('Kind'), regionalAuthorityNumber: L('Regional authority no.'), totalNetKgs: L('Total net kg'), millingInputCapacityBags: L('Daily input (bags)'), id: { hide: true } }, ['kind', 'regionalAuthorityNumber', 'ricemillName', 'totalNetKgs', 'millingInputCapacityBags'])
  } },
  { id: 'pr', dateField: 'date', group: 'Purchases and cash (SDO)', name: 'Purchase receipts (PR)', access: 'all', scoped: true, load: async ({ allowed }) => {
    const [prs, tx, lk] = await Promise.all([db.purchaseReceipts.toArray(), db.transactions.toArray(), lookups()])
    const wsr = new Map(tx.map((t) => [t.id, t]))
    const rows = prs.map((p) => {
      const t = wsr.get(p.wsrTransactionId)
      return { ...scalars(p), ...lk.place(p.warehouseId ?? t?.warehouseId), variety: lk.name(lk.variety, p.varietyId), sdo: lk.name(lk.user, p.sdoUid), wsrSerial: t?.serialNo ?? '', wsrStatus: t?.status ?? '', wsrNetKilos: t?.netKilos ?? null, wsrBags: t?.numberOfBags ?? null, createdAt: iso(p.createdAt), amountVsWsr: t?.netKilos != null && p.unitCost ? Math.round((p.totalAmount ?? 0) - t.netKilos * p.unitCost) : null }
    })
    return build(cutStrict(rows, allowed), {
      date: L('Date'), prNo: L('PR no.'), payeeName: L('Farmer'), payeeAddress: L('Address'), rsbsa: L('RSBSA'), totalAmount: L('Amount (PHP)'), basicCost: L('Basic cost'), unitCost: L('Unit cost'), netKilos: L('Net kg'), numberOfBags: L('Bags'), checkNumber: L('Check no.'), paymentMethod: L('Payment'), sdo: L('Disbursing officer'),
      wsrSerial: L('WSR no.'), wsrNetKilos: L('WSR net kg'), amountVsWsr: L('Amount minus WSR kg x unit cost'), ...Object.fromEntries(FK.map((k) => [k, { hide: true }])),
    }, ['date', 'prNo', 'wsrSerial', 'payeeName', 'payeeAddress', 'warehouse', 'variety', 'numberOfBags', 'netKilos', 'unitCost', 'totalAmount', 'sdo', 'paymentMethod', 'status'])
  } },
  { id: 'cash', dateField: 'date', group: 'Purchases and cash (SDO)', name: 'Cash ledger (replenishments and liquidations)', access: 'wide', load: async () => {
    const [c, lk] = await Promise.all([db.cashLedgerV2.toArray(), lookups()])
    const rows = c.map((r) => ({ ...scalars(r), sdo: lk.name(lk.user, r.sdoUid), createdAt: iso(r.createdAt), voidedAt: iso(r.voidedAt), editedAt: iso(r.editedAt), voided: r.voided ? 'Yes' : 'No', voidedBy: lk.name(lk.user, r.voidedByUid), editedBy: lk.name(lk.user, r.editedByUid) }))
    return build(rows, { date: L('Date'), type: L('Type'), refNo: L('Check / OR no.'), amount: L('Amount (PHP)'), sdo: L('Disbursing officer'), dvNo: L('DV no.'), entryKind: L('Entry kind'), ...Object.fromEntries(FK.map((k) => [k, { hide: true }])) }, ['date', 'type', 'entryKind', 'refNo', 'dvNo', 'amount', 'sdo', 'voided', 'remarks'])
  } },
  { id: 'cash_counts', group: 'Purchases and cash (SDO)', name: 'Cash denomination counts', access: 'wide', load: async () => {
    const [c, lk] = await Promise.all([db.cashDenominationCounts.toArray(), lookups()])
    const rows = []
    for (const r of c) for (const [den, v] of Object.entries(r.counts ?? {})) rows.push({ sdo: lk.name(lk.user, r.sdoUid), denomination: den, bundles: v?.bundles ?? 0, pieces: v?.pcs ?? 0 })
    return build(rows, { denomination: L('Denomination'), sdo: L('Disbursing officer') }, ['sdo', 'denomination', 'bundles', 'pieces'])
  } },
  { id: 'cutoffs', dateField: 'cutoffDate', group: 'Purchases and cash (SDO)', name: 'SDO report cut-offs', access: 'wide', load: async () => {
    const [c, lk] = await Promise.all([db.sdoReportCutoffs.toArray(), lookups()])
    const rows = c.map((r) => ({ ...scalars(r), sdo: lk.name(lk.user, r.sdoUid), createdAt: iso(r.createdAt), prsReported: Array.isArray(r.reportedPrIds) ? r.reportedPrIds.length : 0 }))
    return build(rows, { cutoffDate: L('Cut-off date'), endingBalance: L('Ending balance'), sdo: L('Disbursing officer'), ...Object.fromEntries(FK.map((k) => [k, { hide: true }])) }, ['cutoffDate', 'sdo', 'endingBalance', 'prsReported'])
  } },
  { id: 'prices', group: 'Purchases and cash (SDO)', name: 'Buying prices and ENW factors', access: 'all', load: async () => {
    const [p, e] = await Promise.all([db.buyingPrices.toArray(), db.enwFactors.toArray()])
    const rows = [...p.map((r) => ({ kind: 'Buying price', ...scalars(r), createdAt: iso(r.createdAt) })), ...e.map((r) => ({ kind: 'ENW factor', ...scalars(r) }))]
    return build(rows, { kind: L('Kind'), effectiveFrom: L('Effective from'), dryPrice: L('Dry price'), wetPrice: L('Wet price'), purityLetter: L('Purity'), ddMin: L('DD from'), ddMax: L('DD to'), mcMin: L('MC from'), mcMax: L('MC to'), factor: L('Factor'), id: { hide: true } }, ['kind', 'effectiveFrom', 'dryPrice', 'wetPrice', 'purityLetter', 'ddMin', 'ddMax', 'mcMin', 'mcMax', 'factor'])
  } },
  { id: 'piles', group: 'Piles, sacks and logistics', name: 'Piles', access: 'all', scoped: true, load: async ({ allowed }) => {
    const [piles, lk] = await Promise.all([db.piles.toArray(), lookups()])
    const today = new Date().toISOString().slice(0, 10)
    const rows = piles.map((p) => ({ ...scalars(p), ...lk.place(p.warehouseId), variety: lk.name(lk.variety, p.varietyId), currentNetBags: typeof p.currentKilos === 'number' ? p.currentKilos / NET_BAG_KG : null, state: p.closedDate ? 'Closed' : p.zeroedDate ? 'Empty' : 'Open', daysSinceReceipt: p.dateOfReceipt ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(p.dateOfReceipt).slice(0, 10)}T00:00:00Z`)) / 86400000) : null }))
    return build(cut(rows, allowed), { pileName: L('Pile'), cerealType: L('Cereal'), currentBags: L('Bags'), currentKilos: L('Net kg'), currentNetBags: L('Net bags'), dateOfReceipt: L('Date received'), closedDate: L('Closed on'), zeroedDate: L('Emptied on'), ...Object.fromEntries(FK.map((k) => [k, { hide: true }])) }, ['pileName', 'warehouse', 'province', 'cerealType', 'variety', 'state', 'currentBags', 'currentKilos', 'currentNetBags', 'dateOfReceipt', 'daysSinceReceipt', 'closedDate'])
  } },
  { id: 'pile_boxes', group: 'Piles, sacks and logistics', name: 'Pile layout boxes (floor plan)', access: 'all', scoped: true, load: async ({ allowed }) => {
    const [b, lk] = await Promise.all([db.pileLayoutBoxes.toArray(), lookups()])
    const rows = b.map((x) => ({ ...scalars(x), ...lk.place(x.warehouseId), pile: lk.name(lk.pile, x.pileId, 'pileName') }))
    return build(cut(rows, allowed), { label: L('Box label'), ...Object.fromEntries(FK.map((k) => [k, { hide: true }])) }, ['warehouse', 'label', 'pile', 'assignedDate'])
  } },
  { id: 'pile_hist', dateField: 'occupiedTo', group: 'Piles, sacks and logistics', name: 'Pile layout history', access: 'all', scoped: true, load: async ({ allowed }) => {
    const [b, lk] = await Promise.all([db.pileLayoutHistory.toArray(), lookups()])
    const rows = b.map((x) => ({ ...scalars(x), ...lk.place(x.warehouseId), pile: lk.name(lk.pile, x.pileId, 'pileName') }))
    return build(cut(rows, allowed), { ...Object.fromEntries(FK.map((k) => [k, { hide: true }])) }, ['warehouse', 'pile', 'occupiedTo'])
  } },
  { id: 'sack_inv', group: 'Piles, sacks and logistics', name: 'Sack inventory (opening snapshot)', access: 'all', scoped: true, load: async ({ allowed }) => {
    const [s, lk] = await Promise.all([db.sackInventory.toArray(), lookups()])
    const rows = s.map((x) => ({ ...scalars(x), ...lk.place(x.warehouseId), sackType: lk.name(lk.sack, x.sackTypeId, 'code'), cereal: lk.sack.get(x.sackTypeId)?.category ?? '' }))
    return build(cut(rows, allowed), { asOfDate: L('As of'), sackType: L('Sack type'), ...Object.fromEntries(FK.map((k) => [k, { hide: true }])) }, ['warehouse', 'sackType', 'condition', 'pieces', 'asOfDate'])
  } },
  { id: 'logistics', group: 'Piles, sacks and logistics', name: 'Logistics equipment', access: 'all', scoped: true, load: async ({ allowed }) => {
    const [x, lk] = await Promise.all([db.logisticsItems.toArray(), lookups()])
    const rows = x.map((i) => ({ ...scalars(i), ...lk.place(i.warehouseId), createdAt: iso(i.createdAt), updatedAt: iso(i.updatedAt), updatedByName: lk.name(lk.user, i.updatedBy) }))
    return build(cut(rows, allowed), { name: L('Item'), brandNew: L('Brand new'), forRepair: L('For repair'), ...Object.fromEntries(FK.map((k) => [k, { hide: true }])), updatedBy: { hide: true } }, ['warehouse', 'category', 'name', 'brandNew', 'serviceable', 'unserviceable', 'forRepair', 'utilized', 'transfer', 'available'])
  } },

  // ---- computed with the Stock Desk's own functions, so the numbers are the Stock Desk's numbers ----
  { id: 'sd_summary', group: 'Stock Desk (same figures)', name: 'Stock by warehouse, variety and age (Summary)', access: 'all', scoped: true, computed: true,
    params: [{ id: 'ageSet', type: 'select', label: 'Age brackets', options: [['coarse', 'Coarse'], ['fine', 'Fine'], ['monthly', 'Every month']], def: 'fine' }],
    load: async ({ allowed, params }) => {
      const e = await engine(params, allowed)
      const s = buildSummary(e.ctx(params.ageSet ?? 'fine'), e.inputs, { asOf: params.asOf, filters: { ...e.filters, byProducts: true } })
      const rows = []
      for (const p of s.provinces) for (const r of p.rows) for (const [id, kilos] of r.values) {
        const [cereal, variety, age] = id.split('|')
        if (Math.abs(kilos) >= 0.5) rows.push({ asOf: params.asOf, province: p.name, warehouse: r.label, cereal, variety, age, netBags: kilos / NET_BAG_KG, netKilos: kilos })
      }
      return build(rows, { asOf: L('As of'), age: L('Age bracket'), netBags: L('Net bags'), netKilos: L('Net kg') }, ['asOf', 'province', 'warehouse', 'cereal', 'variety', 'age', 'netBags', 'netKilos'])
    } },
  { id: 'sd_daily', group: 'Stock Desk (same figures)', name: 'Daily inventory (beginning, ADD, LESS, ending)', access: 'all', scoped: true, computed: true,
    params: [{ id: 'ageSet', type: 'select', label: 'Age brackets', options: [['coarse', 'Coarse'], ['fine', 'Fine']], def: 'coarse' }],
    load: async ({ allowed, params }) => {
      const e = await engine(params, allowed)
      const led = buildLedger(e.ctx(params.ageSet ?? 'coarse'), e.inputs, { from: params.from, to: params.to, filters: { ...e.filters, byProducts: true } })
      const rows = []
      const push = (grid, date, movement, sign) => { for (const [rk, row] of grid) { const [province, warehouse] = rk.split('|'); for (const [id, kilos] of row) { const [cereal, variety, age] = id.split('|'); if (Math.abs(kilos) >= 0.5) rows.push({ date, province, warehouse, cereal, variety, age, movement, netKilos: kilos, netBags: kilos / NET_BAG_KG, signedNetBags: (sign * kilos) / NET_BAG_KG }) } } }
      for (const d of led.days) {
        push(d.beginning, d.date, 'Beginning', 0)
        for (const a of d.adds) push(a.grid, d.date, `ADD: ${a.label}`, 1)
        for (const l of d.lesses) push(l.grid, d.date, `LESS: ${l.label}`, -1)
        if (d.adjustment) push(d.adjustment, d.date, 'Closed pile adjustment', 1)
        if (d.openingAdj) push(d.openingAdj, d.date, 'Opening balance correction', 1)
        push(d.ending, d.date, 'Ending', 0)
      }
      return build(rows, { age: L('Age bracket'), movement: L('Movement'), netKilos: L('Net kg'), netBags: L('Net bags'), signedNetBags: L('Change in net bags (+ADD, -LESS)') }, ['date', 'province', 'warehouse', 'cereal', 'variety', 'age', 'movement', 'netBags', 'signedNetBags', 'netKilos'])
    } },
  { id: 'sd_lots', group: 'Stock Desk (same figures)', name: 'Every lot on hand (receipt date, age, pile)', access: 'all', scoped: true, computed: true,
    load: async ({ allowed, params }) => {
      const e = await engine(params, allowed)
      const a = buildAgeLists(e.ctx('fine'), e.inputs, { asOf: params.asOf, filters: { ...e.filters, byProducts: true }, windowDays: 36500, topOld: 1e9 })
      const rows = a.oldest.map((l) => ({ asOf: params.asOf, province: l.province, warehouse: l.warehouse, cereal: l.commodity, variety: l.variety, pile: l.pile, receivedOn: l.lotDate, ageMonths: Math.round(l.months * 100) / 100, bracket: l.bucket, netKilos: l.kilos, netBags: l.kilos / NET_BAG_KG, approximateAge: l.approx ? 'Yes' : 'No' }))
      return build(rows, { asOf: L('As of'), receivedOn: L('Received on'), ageMonths: L('Age (months)'), bracket: L('Age bracket'), netKilos: L('Net kg'), netBags: L('Net bags'), approximateAge: L('Age is approximate') }, ['asOf', 'province', 'warehouse', 'pile', 'cereal', 'variety', 'receivedOn', 'ageMonths', 'bracket', 'netBags', 'netKilos', 'approximateAge'])
    } },
  { id: 'sd_cross', group: 'Stock Desk (same figures)', name: 'Lots about to move to the next age bracket', access: 'all', scoped: true, computed: true,
    params: [{ id: 'days', type: 'number', label: 'Within (days)', def: 30 }],
    load: async ({ allowed, params }) => {
      const e = await engine(params, allowed)
      const a = buildAgeLists(e.ctx('fine'), e.inputs, { asOf: params.asOf, filters: { ...e.filters, byProducts: true }, windowDays: Number(params.days) || 30, topOld: 1 })
      const rows = a.crossing.map((l) => ({ province: l.province, warehouse: l.warehouse, cereal: l.commodity, variety: l.variety, pile: l.pile, receivedOn: l.lotDate, ageMonths: Math.round(l.months * 100) / 100, fromBracket: l.bucket, toBracket: l.nextLabel, movesOn: l.crossDate, netKilos: l.kilos, netBags: l.kilos / NET_BAG_KG }))
      return build(rows, { receivedOn: L('Received on'), ageMonths: L('Age (months)'), fromBracket: L('From bracket'), toBracket: L('To bracket'), movesOn: L('Moves on'), netKilos: L('Net kg'), netBags: L('Net bags') }, ['movesOn', 'province', 'warehouse', 'pile', 'variety', 'fromBracket', 'toBracket', 'netBags', 'receivedOn', 'ageMonths'])
    } },
  { id: 'sd_milling', group: 'Stock Desk (same figures)', name: 'Milling and Issuances (issuances and recoveries)', access: 'all', scoped: true, computed: true,
    load: async ({ allowed, params }) => {
      const e = await engine(params, allowed)
      const d = buildMillingIssuances({ transactions: e.raw.tx, authorities: e.raw.au, warehouses: e.raw.wh, provinces: e.raw.prov, varieties: e.raw.var, transactionTypes: e.raw.types, ricemillAllocations: e.raw.alloc, globalDataStartDate: e.raw.cfg?.dataStartDate ?? null, from: params.from, to: params.to, filters: allowed ? { warehouseIds: allowed } : {} })
      const rows = []
      const add = (group, list) => { for (const r of list) rows.push({ group, date: r.date, authority: r.aiNumber ?? '', wsr: r.serialNo ?? '', province: r.province, warehouse: r.warehouse, customer: r.customer ?? '', mo: r.moNo ?? '', variety: r.variety ?? '', regionalAuthority: r.ran ?? '', netBags: r.bags, netKilos: r.kilos, withdrawnBags: r.withdrawn ?? null, note: r.derived ? r.customer : '' }) }
      add('Private milling: issued', d.milling.issues); add('Private milling: recovered', d.milling.recoveries)
      add('NFA-owned: issued (daily)', d.nfa.issues); add('NFA-owned: recovered', d.nfa.recoveries)
      add('Issuance to LGU', d.lgu.rows); add('Issuance to FTI', d.fti.rows)
      return build(rows, { group: L('Group'), authority: L('Authority no.'), wsr: L('WSR no.'), mo: L('MO / TMO'), regionalAuthority: L('Regional authority no.'), netBags: L('Net bags'), netKilos: L('Net kg'), withdrawnBags: L('Withdrawn net bags') }, ['group', 'date', 'authority', 'wsr', 'province', 'warehouse', 'customer', 'variety', 'netBags', 'netKilos', 'mo', 'regionalAuthority'])
    } },

  { id: 'customers', group: 'Directories', name: 'Customers and farmers', access: 'all', load: async () => {
    const c = await db.customers.toArray()
    const rows = c.map((x) => ({ ...scalars(x), isFarmerOrg: x.isFarmerOrg ? 'Yes' : 'No', members: Array.isArray(x.farmerCoopMembers) ? x.farmerCoopMembers.length : 0 }))
    return build(rows, { name: L('Name'), rsbsa: L('RSBSA'), gender: L('Gender'), address: L('Address'), isFarmerOrg: L('Farmers organization'), members: L('Members'), normalizedName: { hide: true }, ...Object.fromEntries(FK.map((k) => [k, { hide: true }])) }, ['name', 'rsbsa', 'gender', 'address', 'isFarmerOrg', 'members'])
  } },
  { id: 'warehouses', group: 'Directories', name: 'Warehouses and facilities', access: 'all', scoped: true, load: async ({ allowed }) => {
    const lk = await lookups()
    const rows = lk.warehouses.filter((w) => !allowed || allowed.has(w.id)).map((w) => ({ ...scalars(w), province: lk.name(lk.prov, w.provinceId), branch: lk.name(lk.branch, lk.prov.get(w.provinceId)?.branchId) }))
    return build(rows, { code: L('Code'), name: L('Name'), facilityType: L('Facility type'), classifierName: L('Classifier'), ...Object.fromEntries(FK.map((k) => [k, { hide: true }])) }, ['code', 'name', 'facilityType', 'province', 'branch', 'address'])
  } },
  { id: 'varieties', group: 'Directories', name: 'Varieties, sack types and transaction types', access: 'all', load: async () => {
    const lk = await lookups()
    const rows = [
      ...lk.varieties.map((v) => ({ kind: 'Variety', name: v.name, category: v.category })),
      ...lk.sacks.map((s) => ({ kind: 'Sack type', name: s.code, category: s.category, brandNew: s.weights?.BN ?? null, secondHand: s.weights?.SH ?? null, unserviceable: s.weights?.US ?? null })),
      ...lk.types.map((t) => ({ kind: 'Transaction type', name: t.name, category: '' })),
    ]
    return build(rows, { kind: L('Kind'), brandNew: L('Tare BN'), secondHand: L('Tare SH'), unserviceable: L('Tare US') }, ['kind', 'name', 'category'])
  } },
  { id: 'signatories', group: 'Directories', name: 'Signatories', access: 'all', load: async () => {
    const [s, lk] = await Promise.all([db.signatories.toArray(), lookups()])
    const rows = s.map((x) => ({ ...scalars(x), warehouse: lk.name(lk.wh, x.warehouseId) }))
    return build(rows, { warehouseId: { hide: true } }, ['warehouse', 'name', 'position', 'capacity'])
  } },
]

// A computed source needs the Stock Desk's own context.
async function engine(params, allowed) {
  const [piles, transactions, warehouses, provinces, varieties, types, authorities, cfg, alloc] = await Promise.all([
    db.piles.toArray(), db.transactions.toArray(), db.warehouses.toArray(), db.provinces.toArray(), db.varietyTypes.toArray(), db.transactionTypes.toArray(), db.authorities.toArray(), db.reportConfig.get('global'), db.ricemillAllocations.toArray(),
  ])
  const inputs = { piles, transactions, warehouses, globalDataStartDate: cfg?.dataStartDate ?? null, authorities, reserve: true }
  const ctx = (ageSet) => makeContext({ piles, warehouses, provinces, varieties, transactionTypes: types, combine: false, ageSet, opening: cfg?.inventoryOpening ?? null, ageBasis: 'month' })
  return { ctx, inputs, filters: allowed ? { warehouseIds: allowed } : {}, raw: { tx: transactions, au: authorities, wh: warehouses, prov: provinces, var: varieties, types, alloc, cfg } }
}

// ------------------------------------------------------------------------------------------------ public API
export const canUseSource = (src, role) => src.access === 'all' || (src.access === 'wide' && isWideRole(role)) || (src.access === 'admin' && role === 'Admin')
export const sourcesFor = (role) => SOURCES.filter((s) => canUseSource(s, role))
export const sourceById = (id) => SOURCES.find((s) => s.id === id) ?? null

/**
 * Load one source: { rows, fields, main }. `user` decides the scope: Admin and Analyst see everything; staff only their assigned
 * warehouses. `period` ({ from, to }, never before REPORT_FLOOR) cuts every dated source to those days; the Stock Desk sources work
 * out their figures for the same period. A source the role may not open is refused here, not just hidden on screen.
 */
export async function loadSource(id, { user, params = {}, period } = {}) {
  const src = sourceById(id)
  if (!src) throw new Error(`Unknown source ${id}`)
  if (!canUseSource(src, user?.role)) throw new Error('This data is not available to your role.')
  let allowed = isWideRole(user?.role) ? null : new Set(user?.assignedWarehouses ?? [])
  // the warehouse picker: narrow to the chosen warehouses, never beyond what the person is allowed
  if (Array.isArray(params.warehouseIds) && params.warehouseIds.length) allowed = new Set(allowed ? params.warehouseIds.filter((id) => allowed.has(id)) : params.warehouseIds)
  const per = clampPeriod(period)
  const { warehouseIds: _wh, ...rest } = params
  const out = await src.load({ allowed, params: { ...rest, asOf: per.to, from: per.from, to: per.to } })
  const rows = src.dateField ? applyPeriod(out.rows, src.dateField, per) : out.rows
  return { ...out, rows, source: src, dated: !!src.dateField || !!src.computed, period: per }
}

/** Options of a source that are not dates (the dates come from the period). */
export const defaultParams = (src) => {
  const o = {}
  for (const p of src.params ?? []) o[p.id] = p.def ?? ''
  return o
}

export { T, N, D }
