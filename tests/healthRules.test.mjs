import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateHealth, HEALTH_THRESHOLDS as T } from '../src/utils/healthRules.js'

const NOW = Date.parse('2026-10-19T12:00:00Z')
const H = 3600 * 1000
const D = 24 * H
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()
const goodSys = () => [
  { id: 'cloudBackup', at: iso(8 * H), result: 'PASS', records: 7201, driveDelivered: true },
  { id: 'restoreTest', at: iso(17 * D), result: 'PASS', records: 7072, identical: 7072 },
  { id: 'sheetAudit', at: iso(8 * H), errors: 0, warnings: 0, lines: [] },
  { id: 'history', days: [{ date: '2026-10-18', result: 'PASS' }] },
]
const dev = (o = {}) => ({ id: 'd' + Math.random(), name: 'PC', kind: 'pc', lastSeen: iso(5 * 60000), lastSyncAt: iso(5 * 60000), pending: 0, counts: { transactions: 100, piles: 50 }, firstSeen: iso(20 * D), backup: { at: iso(6 * H), ok: true, folder: 'ok' }, ...o })
const run = (o) => evaluateHealth({ systemStatus: goodSys(), devices: [dev()], now: NOW, ...o })

test('everything fine -> overall ok, no attention', () => {
  const r = run({ checks: { stockNotes: 0, errorLogNew: 0 } })
  assert.equal(r.overall, 'ok')
  assert.deepEqual(r.attention, [])
})

test('nothing reported yet -> unknown, never a problem', () => {
  const r = evaluateHealth({ systemStatus: [], devices: [], now: NOW })
  assert.equal(r.overall, 'unknown')
  assert.equal(r.attention.length, 0)
})

test('cloud backup: 31 h amber, 49 h red, FAIL red', () => {
  const sys = (h, result = 'PASS') => goodSys().map((x) => (x.id === 'cloudBackup' ? { ...x, at: iso(h * H), result } : x))
  assert.equal(run({ systemStatus: sys(31) }).cards.backups.level, 'amber')
  assert.equal(run({ systemStatus: sys(49) }).cards.backups.level, 'red')
  assert.equal(run({ systemStatus: sys(2, 'FAIL') }).cards.backups.level, 'red')
  assert.equal(run({ systemStatus: sys(2) }).cards.backups.level, 'ok')
})

test('drive not delivered -> amber', () => {
  const sys = goodSys().map((x) => (x.id === 'cloudBackup' ? { ...x, driveDelivered: false } : x))
  assert.equal(run({ systemStatus: sys }).cards.backups.level, 'amber')
})

test('restore test: failed red, 41 days late amber', () => {
  const sys = (patch) => goodSys().map((x) => (x.id === 'restoreTest' ? { ...x, ...patch } : x))
  assert.equal(run({ systemStatus: sys({ result: 'FAIL' }) }).cards.restore.level, 'red')
  assert.equal(run({ systemStatus: sys({ at: iso(41 * D) }) }).cards.restore.level, 'amber')
})

test('device sync: 25 h amber, 8 days red; waiting entries amber', () => {
  assert.equal(run({ devices: [dev({ lastSyncAt: iso(25 * H) })] }).cards.devices.level, 'amber')
  assert.equal(run({ devices: [dev({ lastSyncAt: iso(8 * D), lastSeen: iso(8 * D) })] }).cards.devices.level, 'red')
  const waiting = run({ devices: [dev({ pending: 14, lastSyncAt: iso(3 * H) })] })
  assert.equal(waiting.cards.devices.level, 'amber')
  assert.match(waiting.attention[0].text, /14 entries waiting/)
})

test('a device not seen for over 30 days is not listed', () => {
  const r = run({ devices: [dev(), dev({ id: 'old', lastSeen: iso(31 * D), lastSyncAt: iso(31 * D) })] })
  assert.equal(r.cards.devices.rows.length, 1)
  assert.equal(r.cards.devices.level, 'ok')
})

test('a device with a broken clock (no dates) does not crash and is amber, not listed as healthy', () => {
  const r = run({ devices: [dev({ lastSyncAt: null })] })
  assert.equal(r.cards.devices.level, 'amber')
  assert.doesNotThrow(() => run({ devices: [dev({ lastSeen: 'garbage' })] }))
})

test('matches cloud: a device far behind the best-synced one is amber', () => {
  const r = run({ devices: [dev({ counts: { transactions: 1000 } }), dev({ name: 'Slow', counts: { transactions: 900 } })] })
  const slow = r.cards.devices.rows.find((x) => x.name === 'Slow')
  assert.equal(slow.matches, 'behind')
  assert.equal(slow.level, 'amber')
  const close = run({ devices: [dev({ counts: { transactions: 1000 } }), dev({ name: 'Near', counts: { transactions: 998 } })] })
  assert.equal(close.cards.devices.rows.find((x) => x.name === 'Near').matches, 'yes')
})

test('PC backup rules: no folder after 3 days, needs permission, stale, failed verify; phones are exempt', () => {
  const lvl = (b, extra = {}) => run({ devices: [dev({ backup: b, ...extra })] }).cards.devices.level
  assert.equal(lvl({ folder: 'none' }), 'amber')
  assert.equal(lvl({ folder: 'none' }, { firstSeen: iso(1 * D) }), 'ok')
  assert.equal(lvl({ folder: 'needs-permission', at: iso(H) }), 'amber')
  assert.equal(lvl({ folder: 'ok', at: iso(49 * H), ok: true }), 'amber')
  assert.equal(lvl({ folder: 'ok', at: iso(H), ok: false }), 'amber')
  assert.equal(run({ devices: [dev({ kind: 'phone', backup: undefined })] }).cards.devices.level, 'ok')
})

test('sheet audit errors red, warnings amber; stock notes amber', () => {
  const sys = (a) => goodSys().map((x) => (x.id === 'sheetAudit' ? { ...x, ...a } : x))
  assert.equal(run({ systemStatus: sys({ errors: 1 }) }).cards.data.level, 'red')
  assert.equal(run({ systemStatus: sys({ warnings: 2 }) }).cards.data.level, 'amber')
  assert.equal(run({ checks: { stockNotes: 3 } }).cards.data.level, 'amber')
})

test('overall is the worst card and attention is sorted red first', () => {
  const sys = goodSys().map((x) => (x.id === 'cloudBackup' ? { ...x, at: iso(60 * H) } : x))
  const r = run({ systemStatus: sys, devices: [dev({ pending: 3, lastSyncAt: iso(3 * H) })] })
  assert.equal(r.overall, 'red')
  assert.equal(r.attention[0].level, 'red')
  assert.ok(r.attention.some((a) => a.level === 'amber'))
  assert.equal(T.cloudBackupAmberHours, 30)
})
