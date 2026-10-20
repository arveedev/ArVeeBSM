import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultPeriod, periodTitle, gsrFileName, folderPath, memoDateText } from '../src/utils/gsr/period.js'
import { warehouseColumns, mergeSettings, normalizeVariety, blockOfVariety } from '../src/utils/gsr/settings.js'
import { monthIndexOf } from '../src/utils/gsr/palayInventory.js'
import { colLetter, refOf } from '../src/utils/gsr/sheetModel.js'
import { prepareGsr } from '../src/utils/gsr/prepare.js'

test('Monday memo reports Friday to Sunday, other days report yesterday', () => {
  assert.deepEqual(defaultPeriod('2026-10-19'), { from: '2026-10-16', to: '2026-10-18' }) // Monday
  assert.deepEqual(defaultPeriod('2026-10-16'), { from: '2026-10-15', to: '2026-10-15' }) // Friday
})

test('titles, file names and the Drive folder', () => {
  assert.equal(periodTitle('2026-10-16', '2026-10-18'), 'OCTOBER 16-18, 2026')
  assert.equal(periodTitle('2026-10-15', '2026-10-15'), 'OCTOBER 15, 2026')
  assert.equal(periodTitle('2026-09-30', '2026-10-02'), 'SEPTEMBER 30 - OCTOBER 2, 2026')
  assert.equal(gsrFileName('2026-10-16', '2026-10-18'), 'GSR OCTOBER 16-18')
  assert.deepEqual(folderPath('2026-10-19'), ['NEWGSR', '2026', '10 OCTOBER'])
  assert.equal(memoDateText('2026-10-19'), '19 October 2026')
})

test('column letters', () => {
  assert.equal(colLetter(0), 'A'); assert.equal(colLetter(25), 'Z'); assert.equal(colLetter(26), 'AA')
  assert.equal(refOf(16, 3), 'D17')
})

test('variety names: m and s marks are ignored, blocks match exactly or by prefix', () => {
  const s = mergeSettings(null)
  assert.equal(normalizeVariety('PD1m-A'), 'PD1-A')
  assert.equal(normalizeVariety('PDm'), 'PDm')
  assert.equal(blockOfVariety(s, 'PD1s-A'), 'PD1-A')
  assert.equal(blockOfVariety(s, 'PW1-B'), 'PW')
  assert.equal(blockOfVariety(s, 'XYZ'), null)
})

test('month brackets of the Stock Desk map to row indexes', () => {
  assert.equal(monthIndexOf('0.1-1.0'), 0)
  assert.equal(monthIndexOf('1.1-2.0'), 1)
  assert.equal(monthIndexOf('25.1-26.0'), 25)
  assert.equal(monthIndexOf('>36'), 36)
})

// A small world: Albay with BSI (+ BSI B, same code) and a dryer; Catanduanes with GID 2.
const provinces = [{ provinceId: 'pv1', name: 'ALBAY' }, { provinceId: 'pv2', name: 'CATANDUANES' }]
const warehouses = [
  { warehouseId: 'w1', name: 'ALB-BSI', code: '050522', provinceId: 'pv1', facilityType: 'Warehouse' },
  { warehouseId: 'w2', name: 'ALB-BSI B', code: '050522', provinceId: 'pv1', facilityType: 'Warehouse' },
  { warehouseId: 'w3', name: 'ALB-PHF SHED', code: '050557', provinceId: 'pv1', facilityType: 'Dryer' },
  { warehouseId: 'w4', name: 'CTD-GID 2', code: '052011', provinceId: 'pv2', facilityType: 'Warehouse' },
]
const varieties = [{ varietyId: 'v1', name: 'PD1m-A' }, { varietyId: 'v2', name: 'PDm' }, { varietyId: 'v9', name: 'ODD-1' }]
const piles = [
  { pileId: 'p1', warehouseId: 'w1', varietyId: 'v1', cerealType: 'Palay', pileName: 'PILE 1' },
  { pileId: 'p2', warehouseId: 'w2', varietyId: 'v2', cerealType: 'Palay', pileName: 'PILE 1' },
  { pileId: 'p3', warehouseId: 'w3', varietyId: 'v1', cerealType: 'Palay', pileName: 'PILE 1' },
  { pileId: 'p4', warehouseId: 'w4', varietyId: 'v1', cerealType: 'Palay', pileName: 'PILE 1' },
]
const wsr = (id, pileId, warehouseId, varietyId, date, bags) => ({ id, type: 'WSR', status: 'Active', date, pileId, warehouseId, varietyId, numberOfBags: bags, netKilos: bags * 50, serialNo: id, createdAt: 1 })
const baseData = (extra = []) => ({
  piles, warehouses, provinces, varieties, transactionTypes: [], authorities: [],
  config: { dataStartDate: '2026-08-31' },
  transactions: [wsr('R1', 'p1', 'w1', 'v1', '2026-09-10', 400), wsr('R2', 'p2', 'w2', 'v2', '2026-10-02', 250), wsr('R3', 'p3', 'w3', 'v1', '2026-10-03', 999), wsr('R4', 'p4', 'w4', 'v1', '2026-10-05', 120), ...extra],
})

test('one column per warehouse code; dryers are left out', () => {
  const cols = warehouseColumns(warehouses, provinces, mergeSettings(null))
  assert.deepEqual(cols.map((c) => `${c.provinceName}:${c.title}:${c.warehouseIds.size}`), ['ALBAY:BSI:2', 'CATANDUANES:GID 2:1'])
})

test('the PALAY INVENTORY ties to the warehouses and prints blank, not zero, where there is no stock', () => {
  const res = prepareGsr(baseData(), { memoISO: '2026-10-19', from: '2026-10-16', to: '2026-10-18' })
  assert.deepEqual(res.checks.blocking, [])
  assert.ok(res.canCreate)
  // 400 + 250 + 120 bags in the three Warehouse-type columns; the dryer's 999 bags are not counted
  assert.equal(Math.round(res.palay.grandBags * 100) / 100, 770)
  for (const m of res.checks.movement) { assert.ok(m.okWalk); assert.ok(m.okSheet) }
  const written = [...res.sheets[0].cells.values()].filter((c) => typeof c === 'number')
  assert.ok(written.every((v) => v !== 0), 'no cell is written as a plain 0')
  assert.ok(res.sheets[0].toPayload().formats.some((f) => f[4].endsWith(';;@')), 'a formula that adds up to 0 shows blank')
  const payload = res.sheets[0].toPayload()
  assert.equal(payload.name, 'PALAY INVENTORY')
  assert.ok(payload.formats.some((f) => f[4] === '#,##0.00;-#,##0.00;;@'))
  assert.equal(payload.rows[0][0], 'FIRST RUN - HAND CHECK')
  assert.equal(payload.rows[10][2], 'GRAINS SITUATIONER REPORT FOR OCTOBER 16-18, 2026')
})

test('a period that reports a movement still ties (opening + received - issued = ending)', () => {
  const res = prepareGsr(baseData([wsr('R5', 'p1', 'w1', 'v1', '2026-10-17', 100)]), { memoISO: '2026-10-19', from: '2026-10-16', to: '2026-10-18' })
  assert.deepEqual(res.checks.blocking, [])
  const bsi = res.checks.movement.find((m) => m.column.endsWith('BSI'))
  assert.equal(Math.round(bsi.received), 100)
  assert.equal(Math.round(bsi.opening), 650)
  assert.equal(Math.round(bsi.ending), 750)
})

test('a palay variety with no report row blocks the file', () => {
  const res = prepareGsr(baseData([wsr('R6', 'p1', 'w1', 'v9', '2026-10-06', 10)]), { memoISO: '2026-10-19', from: '2026-10-16', to: '2026-10-18' })
  assert.ok(!res.canCreate)
  assert.ok(res.checks.blocking.some((b) => b.id === 'unmapped' && b.text.includes('ODD-1')))
})

test('a period before the reports start blocks the file', () => {
  const res = prepareGsr(baseData(), { memoISO: '2026-09-02', from: '2026-08-31', to: '2026-08-31' })
  assert.ok(res.checks.blocking.some((b) => b.id === 'start'))
})

test('the audit file has its five tabs and the tally', () => {
  const res = prepareGsr(baseData(), { memoISO: '2026-10-19', from: '2026-10-16', to: '2026-10-18', appInfo: { version: 'x', databaseId: 'db' } })
  assert.deepEqual(res.audit.sheets.map((s) => s.name), ['Summary', 'Cells', 'Documents', 'Excluded', 'Settings used'])
  assert.equal(res.audit.name, 'GSR OCTOBER 16-18 - AUDIT')
  assert.equal(res.audit.sheets[2].toPayload().rows.length > 3, true)
  assert.equal(res.outside.length, 1)
})

test('read-back verification passes on a faithful copy and names the cell that differs', async () => {
  const { verifyReadback } = await import('../src/utils/gsr/verify.js')
  const res = prepareGsr(baseData(), { memoISO: '2026-10-19', from: '2026-10-16', to: '2026-10-18' })
  const fake = (builders) => builders.map((b) => {
    const values = []
    for (const [ref, v] of b.expected()) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref)
      let c = 0
      for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64)
      const r = Number(m[2]) - 1
      values[r] = values[r] ?? []
      values[r][c - 1] = v
    }
    return { name: b.name, values }
  })
  const good = verifyReadback(res.sheets, fake(res.sheets))
  assert.equal(good.bad.length, 0)
  assert.ok(good.checked > 100)
  const read = fake(res.sheets)
  const cellRef = [...res.sheets[0].expected()].find(([, v]) => typeof v === 'number' && v > 100)[0]
  const m = /^([A-Z]+)(\d+)$/.exec(cellRef)
  let c = 0
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64)
  read[0].values[Number(m[2]) - 1][c - 1] += 1
  const bad = verifyReadback(res.sheets, read)
  assert.equal(bad.bad.length, 1)
  assert.equal(bad.bad[0].ref, cellRef)
})
