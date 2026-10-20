// Prepares a GSR in memory (pure, no database, nothing written anywhere): computes the sheets, runs the checks that must pass
// before a file may be created, and builds the audit file. The caller passes the app's tables.
//
// The tally rule (owner, 2026-10-20): every GSR is checked against the warehouses' own totals for the period it reports.
// Per warehouse column: opening stock + everything received - everything issued (+ the corrections the Stock Desk applies) =
// ending stock, and the ending stock is what the sheet prints. Any difference blocks the file.

import {
  makeContext, buildSummary, buildLedger, buildSelfCheck, longDate,
} from '../inventoryReport.js'
import { buildLots } from '../inventoryLots.js'
import { mergeSettings, warehouseColumns } from './settings.js'
import { buildPalayInventory, SHEET_PALAY } from './palayInventory.js'
import { periodTitle, gsrFileName, folderPath, monthStart, addDays } from './period.js'
import { buildAuditFile } from './audit.js'

export const SHEET_PLAN = [
  { name: SHEET_PALAY, built: true },
  { name: 'RICE INVENTORY', built: false }, { name: 'DISTRIBUTION PER VARIETY', built: false }, { name: 'DIST. (TODAY)', built: false },
  { name: 'DIST. (MONTH)', built: false }, { name: 'DIST. (YEAR)', built: false }, { name: 'DISPERSAL', built: false },
  { name: 'PROCUREMENT 1', built: false }, { name: 'PROCUREMENT 2', built: false }, { name: 'PROC.MILL', built: false }, { name: 'PRICES', built: false },
]

const TOL_BAGS = 0.02 // 1 kg: rounding dust under 0.1 kg per figure is not printed
const bags = (kilos) => kilos / 50

// Flatten one grid (Map rowKey -> Map colId -> kilos) into palay kilos per warehouse column group.
const palayByGroup = (grid, labelToGroup) => {
  const out = new Map()
  for (const [rk, row] of grid) {
    const g = labelToGroup.get(rk)
    if (!g) continue
    for (const [id, v] of row) if (id.startsWith('Palay|')) out.set(g.key, (out.get(g.key) ?? 0) + v)
  }
  return out
}
const addInto = (target, grid, sign, labelToGroup) => {
  for (const [k, v] of palayByGroup(grid, labelToGroup)) target.set(k, (target.get(k) ?? 0) + sign * v)
}

/**
 * @param data { piles, transactions, warehouses, provinces, varieties, transactionTypes, authorities, config, storedSettings }
 * @param p    { memoISO, from, to, appInfo, firstRun }
 */
export const prepareGsr = (data, p) => {
  const { piles, transactions, warehouses, provinces, varieties, transactionTypes, authorities, config } = data
  const settings = mergeSettings(data.storedSettings)
  const blocking = []
  const warnings = []
  const startISO = config?.dataStartDate ? addDays(config.dataStartDate, 1) : null
  if (!p.from || !p.to || p.from > p.to) blocking.push({ id: 'dates', text: 'The period is not valid: the first day is after the last day.' })
  if (startISO && p.from < startISO) blocking.push({ id: 'start', text: `The period starts before the reports do (${longDate(startISO)}); the GSR counts from September forward only.` })
  if (p.memoISO < p.to) blocking.push({ id: 'memo', text: 'The memo date is before the last day reported.' })

  const columns = warehouseColumns(warehouses, provinces, settings)
  const labelToGroup = new Map()
  for (const g of columns) for (const l of g.labels) labelToGroup.set(`${g.provinceName}|${l}`, g)
  const allowed = new Set(columns.flatMap((g) => [...g.warehouseIds]))
  const ctx = makeContext({ piles, warehouses, provinces, varieties, transactionTypes, combine: false, ageSet: 'monthly', opening: config?.inventoryOpening ?? null, ageBasis: 'month' })
  const inputs = { piles, transactions, warehouses, globalDataStartDate: config?.dataStartDate ?? null, authorities, reserve: true }
  const filters = { warehouseIds: allowed, commodity: 'Palay', byProducts: false }

  const summary = buildSummary(ctx, inputs, { asOf: p.to, filters })
  const palay = buildPalayInventory({ summary, columns, settings, memoISO: p.memoISO, from: p.from, to: p.to })
  for (const u of palay.unplaced) blocking.push({ id: 'unplaced', text: `Palay stock with no report column: ${u.warehouse}, ${u.variety}, ${(bags(u.kilos)).toFixed(2)} bags.` })
  for (const u of palay.unmapped) blocking.push({ id: 'unmapped', text: `Palay variety with no report row: ${u.variety} (${u.warehouse}, ${(bags(u.kilos)).toFixed(2)} bags). Add it to a variety in the GSR settings.` })

  if (palay.placedKilos === 0 && (transactions ?? []).length > 0) blocking.push({ id: 'empty', text: 'The palay inventory is completely empty. That is not normal, so the file is not created. Check the date and the warehouse columns.' })

  // --- The tally against the warehouses' totals for the period -----------------------------------------------------
  const ties = []
  const movement = []
  const ledger = startISO ? buildLedger(ctx, inputs, { from: startISO, to: p.to, filters }) : { days: [], truncated: false }
  if (ledger.truncated) blocking.push({ id: 'truncated', text: 'The period is longer than the Daily inventory can walk day by day, so the tally cannot be proven.' })
  const lastDay = ledger.days.at(-1)
  const endingByGroup = new Map()
  if (lastDay) addInto(endingByGroup, lastDay.ending, 1, labelToGroup)
  // opening of the period = the ending of the last day before it
  const before = [...ledger.days].filter((d) => d.date < p.from).at(-1)
  const openingByGroup = new Map()
  if (before) addInto(openingByGroup, before.ending, 1, labelToGroup)
  const firstIn = ledger.days.find((d) => d.date >= p.from)
  if (!before && firstIn) addInto(openingByGroup, firstIn.beginning, 1, labelToGroup)
  const addedByGroup = new Map()
  const lessedByGroup = new Map()
  const adjByGroup = new Map()
  for (const d of ledger.days) {
    if (d.date < p.from || d.date > p.to) continue
    for (const x of d.adds) addInto(addedByGroup, x.grid, 1, labelToGroup)
    for (const x of d.lesses) addInto(lessedByGroup, x.grid, 1, labelToGroup)
    if (d.adjustment) addInto(adjByGroup, d.adjustment, 1, labelToGroup)
    if (d.openingAdj) addInto(adjByGroup, d.openingAdj, 1, labelToGroup)
  }
  // what the sheet prints per column group
  const sheetByGroup = new Map()
  for (const g of columns) sheetByGroup.set(g.key, 0)
  for (const c of palay.cells) {
    const grp = columns.find((g) => `${g.provinceName} / ${g.title}` === c.colLabel)
    if (grp) sheetByGroup.set(grp.key, (sheetByGroup.get(grp.key) ?? 0) + c.value)
  }
  for (const g of columns) {
    const open = bags(openingByGroup.get(g.key) ?? 0)
    const add = bags(addedByGroup.get(g.key) ?? 0)
    const less = bags(lessedByGroup.get(g.key) ?? 0)
    const adj = bags(adjByGroup.get(g.key) ?? 0)
    const end = bags(endingByGroup.get(g.key) ?? 0)
    const shown = sheetByGroup.get(g.key) ?? 0
    const walk = open + add - less + adj
    const okWalk = Math.abs(walk - end) <= TOL_BAGS
    const okSheet = Math.abs(shown - end) <= TOL_BAGS
    movement.push({ column: `${g.provinceName} / ${g.title}`, opening: open, received: add, issued: less, corrections: adj, ending: end, printed: shown, okWalk, okSheet })
    if (!okWalk) blocking.push({ id: 'walk', text: `${g.title}: opening ${open.toFixed(2)} + received ${add.toFixed(2)} - issued ${less.toFixed(2)} + corrections ${adj.toFixed(2)} = ${walk.toFixed(2)}, but the warehouse ending stock is ${end.toFixed(2)} bags.` })
    if (!okSheet) blocking.push({ id: 'sheet', text: `${g.title}: the sheet prints ${shown.toFixed(2)} bags but the warehouse ending stock is ${end.toFixed(2)} bags.` })
  }
  const endingTotal = bags([...endingByGroup.values()].reduce((a, b) => a + b, 0))
  ties.push({ label: 'PALAY INVENTORY grand total = Daily inventory ending of the Warehouse columns', a: palay.grandBags, b: endingTotal, ok: Math.abs(palay.grandBags - endingTotal) <= TOL_BAGS })
  ties.push({ label: 'PALAY INVENTORY grand total = Stock Desk Summary palay total', a: palay.grandBags, b: bags(palay.placedKilos), ok: Math.abs(palay.grandBags - bags(palay.placedKilos)) <= TOL_BAGS })
  const pdGrandVal = (() => { const x = palay.sheet.get(palay.sheet.meta.pdGrandRow, palay.sheet.meta.grandCol); return x && typeof x === 'object' ? x.v : 0 })()
  const rollVal = (() => { const x = palay.sheet.get(palay.sheet.meta.rollSubRow, palay.sheet.meta.grandCol); return x && typeof x === 'object' ? x.v : 0 })()
  ties.push({ label: 'PD roll-up sub-total = GRAND TOTAL of the PD varieties', a: rollVal, b: pdGrandVal, ok: Math.abs(rollVal - pdGrandVal) <= TOL_BAGS })
  for (const t of ties) if (!t.ok) blocking.push({ id: 'tie', text: `${t.label}: ${t.a.toFixed(2)} against ${t.b.toFixed(2)} bags.` })

  // The Stock Desk's own self-check: shown as warnings (some lines concern rice, which this sheet does not print).
  let selfCheck = []
  try { selfCheck = startISO ? buildSelfCheck(ctx, inputs, { asOf: p.to }) : [] } catch { selfCheck = [] }
  for (const s of selfCheck) if (!s.ok) warnings.push({ id: 'self', text: `Stock Desk self-check: ${s.title}${s.detail?.length ? ` (${s.detail[0]})` : ''}` })
  const shortAuth = buildLots({ ...inputs, asOf: p.to, reserve: true }).authShort ?? []
  if (shortAuth.length) warnings.push({ id: 'auth', text: `${shortAuth.length} authorities reserve more than the stock available (information only).` })

  // --- Lots behind the figures, for the audit file ------------------------------------------------------------------
  const txById = new Map((transactions ?? []).map((t) => [t.id, t]))
  const pileById = new Map((piles ?? []).map((x) => [x.pileId, x]))
  const whName = new Map((warehouses ?? []).map((w) => [w.warehouseId, w.name]))
  const varietyName = new Map((varieties ?? []).map((v) => [v.varietyId, v.name]))
  const lotState = buildLots({ ...inputs, asOf: p.to })
  const lots = []
  for (const [pileId, st] of lotState) {
    const pile = pileById.get(pileId)
    if (!pile || pile.cerealType !== 'Palay' || !allowed.has(pile.warehouseId)) continue
    for (const lot of st.lots) {
      if (Math.abs(lot.kilos) < 0.0005) continue
      const tx = txById.get(lot.lotId)
      const g = columns.find((c) => c.warehouseIds.has(pile.warehouseId))
      lots.push({
        column: g ? `${g.provinceName} / ${g.title}` : '', warehouse: whName.get(pile.warehouseId) ?? '', pile: pile.pileName ?? '',
        variety: varietyName.get(lot.varietyId ?? pile.varietyId) ?? '', received: String(lot.date ?? '').slice(0, 10),
        document: tx ? `${tx.type ?? ''} ${tx.serialNo ?? ''}`.trim() : (lot.source ?? ''), customer: tx?.customerName ?? '', netBags: bags(lot.kilos),
      })
    }
  }
  const lotsTotal = lots.reduce((a, l) => a + l.netBags, 0)
  const outside = (warehouses ?? []).filter((w) => !allowed.has(w.warehouseId) && (w.facilityType ?? 'Warehouse') !== 'Warehouse')

  if (p.firstRun !== false) { palay.sheet.set(0, 0, 'FIRST RUN - HAND CHECK'); palay.sheet.boldRange(0, 0, 0, 0); palay.sheet.fill(0, 0, 0, 3, '#ffe599') }

  const memoTitle = `GRAINS SITUATIONER REPORT FOR ${periodTitle(p.from, p.to)}`
  const result = {
    memoISO: p.memoISO, from: p.from, to: p.to, title: memoTitle,
    fileName: gsrFileName(p.from, p.to), folder: folderPath(p.memoISO),
    settings, columns, sheets: [palay.sheet], palay,
    checks: { blocking, warnings, ties, movement, selfCheck },
    lots, lotsTotal, outside,
    monthFrom: monthStart(p.to), yearFrom: startISO,
    canCreate: blocking.length === 0,
  }
  result.audit = buildAuditFile(result, { appInfo: p.appInfo ?? {}, firstRun: p.firstRun !== false })
  return result
}
