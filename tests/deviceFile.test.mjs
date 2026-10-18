import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDeviceFileText, verifyDeviceFile, parseDeviceFileText, diffAgainstLocal, stableStringify, deviceFileBaseName, isOwnDeviceFileName, filesToPrune, RESTORE_EXCLUDED_TABLES } from '../src/utils/deviceFile.js'

const tables = {
  transactions: [{ id: 't1', serialNo: '1', bags: 10 }, { id: 't2', serialNo: '2', bags: 5 }],
  users: [{ uid: 'u1', name: 'A' }],
  piles: [],
  errorLogs: [{ id: 'e1' }],
}
const meta = { deviceId: 'd1', deviceName: 'Admin PC', dbId: 'zv432njdm', appVersion: '1.10-394', pending: {} }

test('round trip passes and keeps the data', async () => {
  const { text } = await buildDeviceFileText(meta, tables, { databaseName: 'BSMDatabase' })
  const v = await verifyDeviceFile(text)
  assert.equal(v.ok, true, v.problems.join('; '))
  assert.equal(v.meta.counts.transactions, 2)
  assert.equal(v.meta.counts.piles, 0)
  assert.equal(v.data.tables.users[0].name, 'A')
})

test('a changed byte fails the checksum', async () => {
  const { text } = await buildDeviceFileText(meta, tables)
  const bad = text.replace('"bags":10', '"bags":11')
  const v = await verifyDeviceFile(bad)
  assert.equal(v.ok, false)
  assert.match(v.problems.join(' '), /checksum/)
})

test('a file cut short is reported unusable, not thrown', async () => {
  const { text } = await buildDeviceFileText(meta, tables)
  const v = await verifyDeviceFile(text.slice(0, text.length - 40))
  assert.equal(v.ok, false)
})

test('a header with wrong counts fails even when the checksum matches', async () => {
  const { text } = await buildDeviceFileText(meta, tables)
  const cut = text.indexOf('\n')
  const m = JSON.parse(text.slice(0, cut)); m.counts.transactions = 99
  const v = await verifyDeviceFile(JSON.stringify(m) + text.slice(cut))
  assert.equal(v.ok, false)
  assert.match(v.problems.join(' '), /transactions/)
})

test('wrong format and non-files are refused', async () => {
  assert.equal((await verifyDeviceFile('hello')).ok, false)
  assert.equal((await verifyDeviceFile('{"format":"other"}\n{}')).ok, false)
  assert.throws(() => parseDeviceFileText('{"a":1}'), /not a BSM device backup/)
})

test('a file with no database id is not usable', async () => {
  const { text } = await buildDeviceFileText({ ...meta, dbId: '' }, tables)
  assert.equal((await verifyDeviceFile(text)).ok, false)
})

test('diff: only absent ids are missing; differing records are listed, never planned; excluded tables skipped', async () => {
  const { text } = await buildDeviceFileText(meta, tables)
  const { data } = await verifyDeviceFile(text)
  const local = {
    transactions: new Map([['t1', stableStringify(tables.transactions[0])], ['t2', stableStringify({ id: 't2', serialNo: '2', bags: 6 })]]),
    users: new Map(),
  }
  const keyOf = (t) => (t === 'users' ? 'uid' : 'id')
  const d = diffAgainstLocal(data, local, keyOf)
  assert.deepEqual(d.perTable.transactions, { inFile: 2, missing: 0, same: 1, different: 1, skipped: false })
  assert.equal(d.perTable.users.missing, 1)
  assert.equal(d.totalMissing, 1)
  assert.equal(d.totalDifferent, 1)
  assert.equal(d.missing.users[0].uid, 'u1')
  assert.equal(d.perTable.errorLogs, undefined)
  assert.ok(RESTORE_EXCLUDED_TABLES.has('errorLogs'))
})

test('diff: a table with no single key is skipped and reported', async () => {
  const { text } = await buildDeviceFileText(meta, { weird: [{ a: 1 }] })
  const { data } = await verifyDeviceFile(text)
  const d = diffAgainstLocal(data, {}, () => null)
  assert.equal(d.perTable.weird.skipped, true)
  assert.equal(d.totalMissing, 0)
})

test('file names are safe and only own files are pruned, keeping at least 30 days', () => {
  assert.equal(deviceFileBaseName('Admin PC (Arvee)!', '2026-10-19'), 'bsm-admin-pc-arvee-2026-10-19')
  assert.equal(deviceFileBaseName('', '2026-10-19'), 'bsm-pc-2026-10-19')
  assert.equal(isOwnDeviceFileName('bsm-admin-pc-2026-10-19.json.gz'), true)
  assert.equal(isOwnDeviceFileName('bsm-admin-pc-2026-10-19.manifest.json'), true)
  assert.equal(isOwnDeviceFileName('notes.txt'), false)
  assert.equal(isOwnDeviceFileName('bsm-2026-10-19.zip'), false)
  const names = ['notes.txt', 'bsm-2026-10-19.zip']
  for (let d = 1; d <= 50; d++) { const day = `2026-09-${String(d).padStart(2, '0')}`; if (d <= 30) { names.push(`bsm-pc-${day}.json.gz`, `bsm-pc-${day}.manifest.json`) } }
  for (let d = 1; d <= 20; d++) { const day = `2026-10-${String(d).padStart(2, '0')}`; names.push(`bsm-pc-${day}.json.gz`, `bsm-pc-${day}.manifest.json`) }
  const del = filesToPrune(names, 45)
  assert.ok(del.every(isOwnDeviceFileName))
  assert.equal(del.length, 10) // 50 own dates, 45 kept -> 5 oldest dates x 2 files
  assert.ok(del.includes('bsm-pc-2026-09-01.json.gz') && !del.includes('bsm-pc-2026-09-06.json.gz'))
  assert.equal(filesToPrune(names, 10).length, 40) // asked for fewer than 30 days: still keeps 30 dates
})
