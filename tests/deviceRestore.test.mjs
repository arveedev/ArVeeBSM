import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDeviceFileText } from '../src/utils/deviceFile.js'
import { checkAnyBackup, planRestore, applyRestore, restorePhrase, databaseIdOf } from '../src/utils/deviceRestore.js'

// a tiny stand-in for Dexie: tables with a key path, rows, toArray and bulkAdd (which fails on an existing key like Dexie)
const fakeDb = (tables) => ({
  table(name) {
    const t = tables[name]
    if (!t) throw new Error('no such table')
    return {
      schema: { primKey: { keyPath: t.key } },
      toArray: async () => [...t.rows],
      bulkAdd: async (recs) => {
        const failures = []
        for (const r of recs) { if (t.rows.some((x) => x[t.key] === r[t.key])) failures.push(r); else t.rows.push(r) }
        if (failures.length) throw Object.assign(new Error('BulkError'), { failures })
      },
    }
  },
})

const fileTables = {
  transactions: [{ id: 't1', n: 1 }, { id: 't2', n: 2 }, { id: 't3', n: 3 }],
  users: [{ uid: 'u1', name: 'A' }],
  errorLogs: [{ id: 'e1' }],
  gone: [{ id: 'x' }],
}
const device = async (meta = {}) => (await buildDeviceFileText({ deviceId: 'd1', deviceName: 'PC', dbId: 'zv432njdm', ...meta }, fileTables)).text

test('plan: missing records found, differing listed, excluded and unknown tables not planned', async () => {
  const parsed = await checkAnyBackup(await device())
  assert.equal(parsed.ok, true)
  const db = fakeDb({ transactions: { key: 'id', rows: [{ id: 't1', n: 1 }, { id: 't2', n: 99 }] }, users: { key: 'uid', rows: [] }, errorLogs: { key: 'id', rows: [] } })
  const plan = await planRestore(db, parsed, 'zv432njdm')
  assert.equal(plan.blocked, null)
  assert.equal(plan.diff.totalMissing, 2) // t3 and u1
  assert.equal(plan.diff.totalDifferent, 1) // t2
  assert.deepEqual(plan.unknownTables, ['gone'])
  assert.equal(plan.diff.perTable.errorLogs, undefined)
})

test('a file from another database is blocked', async () => {
  const parsed = await checkAnyBackup(await device({ dbId: 'zother' }))
  const plan = await planRestore(fakeDb({ transactions: { key: 'id', rows: [] } }), parsed, 'zv432njdm')
  assert.match(plan.blocked, /zother/)
})

test('apply adds only the missing records, never changes existing ones, counts a race as failed', async () => {
  const rows = [{ id: 't1', n: 1 }, { id: 't2', n: 99 }]
  const db = fakeDb({ transactions: { key: 'id', rows } })
  const res = await applyRestore(db, { transactions: [{ id: 't2', n: 2 }, { id: 't3', n: 3 }] })
  assert.deepEqual(res, { added: 1, failed: 1 })
  assert.equal(rows.find((r) => r.id === 't2').n, 99) // untouched
  assert.equal(rows.length, 3)
})

test('a damaged device file is refused and an old plain export is accepted with no checksum', async () => {
  const text = await device()
  assert.equal((await checkAnyBackup(text.slice(0, text.length - 50))).ok, false)
  const plain = JSON.stringify({ exportedAt: '2026-10-15T00:00:00Z', tables: { transactions: [{ id: 'a' }] } })
  const r = await checkAnyBackup(plain)
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'export')
  assert.equal((await checkAnyBackup('garbage')).ok, false)
  assert.equal((await checkAnyBackup('{"nothing":1}')).ok, false)
})

test('phrase and database id helpers', () => {
  assert.equal(restorePhrase(41), 'RESTORE 41 RECORDS INTO THIS PC')
  assert.equal(databaseIdOf('https://zv432njdm.dexie.cloud'), 'zv432njdm')
  assert.equal(databaseIdOf('nonsense'), '')
})
