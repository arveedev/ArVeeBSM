#!/usr/bin/env node
// Gap recovery (R3) - backup-and-restore-plan.md section 8.7.
//
// WHEN: the cloud database was lost, it has been restored from the latest backup (R2), and records entered after
// that backup may exist only on devices ("Admin > Backup > Export All Data" files) or in a newer export.
//
// RULES (the plan's, enforced here):
//   1. Insert-only. A record is added only when its table + id is absent from the restored database. An existing
//      record is never overwritten.
//   2. Transactional tables only: transactions, purchaseReceipts, cashLedgerV2, cashDenominationCounts,
//      pileLayoutBoxes, pileLayoutHistory. Configuration tables (users, authorities, warehouses, varieties,
//      prices, signatories, ...) are never merged, so a record legitimately removed after the backup cannot come back.
//   3. Conflicts (same id, different content) are reported and left alone; this script never picks a winner.
//   4. `preview` writes nothing to any database. `apply` takes a safety export, re-checks, asks for a typed phrase,
//      imports ONLY the missing records, then proves nothing that existed changed.
//
// USAGE (from the repository root; `apply` needs the TARGET database's dexie-cloud.json + dexie-cloud.key in --cwd):
//   node tools/gap-recovery/gap.mjs preview --restored <export.zip|.ndjson> --device <file> [--device <file> ...]
//        [--plan gap-plan.json] [--list]
//   node tools/gap-recovery/gap.mjs apply --plan gap-plan.json --cwd <folder with dexie-cloud.json> [--dry]
//
// A "--device" file is a PC's automatic device backup (.json.gz, checked first: a damaged one is refused), an Export All
// Data file (.json: { tables: { name: [records] } }) or a Dexie Cloud export (.zip / .ndjson), which lets one export
// stand in for a device when rehearsing.

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import JSZip from 'jszip'
import { verifyDeviceFile } from '../../src/utils/deviceFile.js'

// the only tables gap recovery may touch, with the field that is each table's primary key
export const ELIGIBLE = {
  transactions: 'id',
  purchaseReceipts: 'prId',
  cashLedgerV2: 'id',
  cashDenominationCounts: 'sdoUid',
  pileLayoutBoxes: 'id',
  pileLayoutHistory: 'id',
}
// fields that differ between a device copy and the cloud copy without meaning the record differs
const IGNORE = new Set(['owner', 'realmId', 'isSynced', 'hasBeenBackedUp', 'syncFailureLogged', 'staleCleanupLogged', 'staleSheetSerials'])
const DEFAULT_REALM = 'bsm-app-service@system.local'

const arg = (argv, name) => { const out = []; for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1]); return out }
const flag = (argv, name) => argv.includes(name)

const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x))

/** Reads any supported file into { tables: { table: Map(id -> data) }, rows, dbId, schema, exportedAt, kind }. */
export const readSource = async (file) => {
  const buf = fs.readFileSync(file)
  const ext = path.extname(file).toLowerCase()
  const out = { file, tables: {}, kind: '', dbId: null, schema: null, exportedAt: null }
  const add = (table, id, data) => { (out.tables[table] ??= new Map()).set(String(id), data) }
  if (ext === '.json' || ext === '.gz') {
    let j
    if (ext === '.gz') {
      let text
      try { text = zlib.gunzipSync(buf).toString('utf8') } catch { throw new Error(`${file}: not a readable gzip file (damaged or cut short)`) }
      const v = await verifyDeviceFile(text)
      if (!v.ok) throw new Error(`${file}: failed its check: ${v.problems.join('; ')}`)
      j = v.data
      out.meta = v.meta
    } else {
      j = JSON.parse(buf.toString('utf8'))
    }
    if (!j?.tables) throw new Error(`${file}: not an Export All Data file (no "tables")`)
    out.kind = ext === '.gz' ? 'device-file' : 'device-json'
    out.exportedAt = j.exportedAt ?? null
    for (const [table, list] of Object.entries(j.tables)) {
      const pk = ELIGIBLE[table]
      for (const rec of list) {
        if (!pk) { add(table, JSON.stringify(rec).length + ':' + crypto.createHash('sha1').update(stable(rec)).digest('hex'), rec); continue }
        const { [pk]: id, ...rest } = rec
        if (id == null) continue
        add(table, id, { ...rest, __realm: rec.realmId ?? DEFAULT_REALM })
      }
    }
    return out
  }
  let text
  if (ext === '.zip') {
    const zip = await JSZip.loadAsync(buf)
    const name = Object.keys(zip.files).find((n) => n.endsWith('.ndjson'))
    if (!name) throw new Error(`${file}: no data.ndjson inside`)
    text = await zip.files[name].async('string')
  } else {
    text = buf.toString('utf8')
  }
  out.kind = 'cloud-export'
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const r = JSON.parse(line)
    if (r.type === 'header') { out.dbId = r.dbId; out.exportedAt = r.exportedAt } else if (r.type === 'schema') out.schema = r
    else if (r.table) add(r.table, r.id, { ...r.data, __realm: r.realm ?? DEFAULT_REALM })
  }
  return out
}

const comparable = (data) => {
  const o = {}
  for (const k of Object.keys(data)) if (!IGNORE.has(k) && k !== '__realm') o[k] = data[k]
  return stable(o)
}
const differingFields = (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((k) => !IGNORE.has(k) && k !== '__realm' && stable(a[k]) !== stable(b[k]))
}
const label = (table, id, d) => {
  if (table === 'transactions') return `${d.type ?? '?'} ${d.serialNo ?? '?'} ${d.date ?? ''} (${id.slice(0, 8)})`
  if (table === 'purchaseReceipts') return `PR ${id} ${d.date ?? ''}`
  return `${table} ${id.slice(0, 12)}`
}

/** The gap: for each device, per eligible table, what is absent from the restored database, and any conflicts. */
export const computeGap = (restored, devices) => {
  const perDevice = []
  const wanted = new Map() // `${table}|${id}` -> { table, id, data, from: [files] }
  const conflicts = []
  for (const dev of devices) {
    const stats = {}
    for (const table of Object.keys(ELIGIBLE)) {
      const have = restored.tables[table] ?? new Map()
      const mine = dev.tables[table] ?? new Map()
      const s = { onDevice: mine.size, identical: 0, missing: 0, conflicts: 0 }
      for (const [id, data] of mine) {
        if (have.has(id)) {
          if (comparable(have.get(id)) === comparable(data)) s.identical += 1
          else {
            s.conflicts += 1
            conflicts.push({ kind: 'differs from restored database', table, id, label: label(table, id, data), file: dev.file, fields: differingFields(have.get(id), data) })
          }
          continue
        }
        s.missing += 1
        const key = `${table}|${id}`
        const prev = wanted.get(key)
        if (!prev) wanted.set(key, { table, id, data, from: [dev.file] })
        else if (comparable(prev.data) === comparable(data)) prev.from.push(dev.file)
        else conflicts.push({ kind: 'two devices disagree (not inserted)', table, id, label: label(table, id, data), file: dev.file, fields: differingFields(prev.data, data), otherFile: prev.from[0] })
      }
      stats[table] = s
    }
    perDevice.push({ file: dev.file, kind: dev.kind, exportedAt: dev.exportedAt, meta: dev.meta ?? null, stats })
  }
  // an id two devices disagree about is never inserted
  const blocked = new Set(conflicts.filter((c) => c.kind.startsWith('two devices')).map((c) => `${c.table}|${c.id}`))
  const insert = [...wanted.values()].filter((w) => !blocked.has(`${w.table}|${w.id}`))
  return { perDevice, insert, conflicts }
}

const toRow = (w) => {
  const { __realm, ...data } = w.data
  return { type: 'row', realm: __realm ?? DEFAULT_REALM, table: w.table, id: w.id, data }
}

const printGap = (restored, gap, list) => {
  console.log(`\nRestored database: ${restored.file}  (exported ${restored.exportedAt ?? '?'}, db ${restored.dbId ?? '?'})`)
  for (const d of gap.perDevice) {
    console.log(`\nDevice file: ${d.file}  [${d.kind}${d.exportedAt ? `, exported ${d.exportedAt}` : ''}]`)
    if (d.meta) {
      const waiting = Object.values(d.meta.pending ?? {}).reduce((a, b) => a + b, 0)
      console.log(`  made by ${d.meta.deviceName ?? '?'} (${d.meta.user || 'no user'}), app ${d.meta.appVersion ?? '?'}, database ${d.meta.dbId}${waiting ? `; ${waiting} entries were still WAITING TO SEND when it was saved (they may exist nowhere else)` : ''}`)
    }
    console.log('  table                   on device   identical   MISSING   conflicts')
    for (const [t, s] of Object.entries(d.stats)) console.log(`  ${t.padEnd(22)} ${String(s.onDevice).padStart(9)} ${String(s.identical).padStart(11)} ${String(s.missing).padStart(9)} ${String(s.conflicts).padStart(11)}`)
  }
  const byTable = {}
  for (const w of gap.insert) byTable[w.table] = (byTable[w.table] ?? 0) + 1
  console.log(`\nWould insert ${gap.insert.length} record(s): ${Object.entries(byTable).map(([t, n]) => `${t} ${n}`).join(', ') || 'none'}`)
  const show = list ? gap.insert : gap.insert.slice(0, 12)
  for (const w of show) console.log(`   + ${label(w.table, w.id, w.data)}  [from ${w.from.map((f) => path.basename(f)).join(', ')}]`)
  if (!list && gap.insert.length > show.length) console.log(`   ... and ${gap.insert.length - show.length} more (use --list for all)`)
  console.log(`\nConflicts (reported, never inserted, never overwritten): ${gap.conflicts.length}`)
  // grouped by what differs, so a thousand look-alikes read as a few lines; --list shows every one
  const groups = new Map()
  for (const c of gap.conflicts) {
    const k = `${c.kind} | ${c.table} | ${c.fields.join(', ') || '(content)'}`
    if (!groups.has(k)) groups.set(k, { n: 0, example: c })
    groups.get(k).n += 1
  }
  for (const [k, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) console.log(`   ! ${String(g.n).padStart(5)} x ${k}   e.g. ${g.example.label}`)
  if (list) for (const c of gap.conflicts) console.log(`      - ${c.label}  [${c.kind}; differs in ${c.fields.join(', ') || '(content)'}; ${path.basename(c.file)}]`)
}

const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a) }) })

const preview = async (argv) => {
  const restoredFile = arg(argv, '--restored')[0]
  const deviceFiles = arg(argv, '--device')
  if (!restoredFile || deviceFiles.length === 0) throw new Error('usage: preview --restored <export> --device <file> [--device <file> ...] [--plan out.json] [--list]')
  const restored = await readSource(restoredFile)
  const devices = []
  for (const f of deviceFiles) devices.push(await readSource(f))
  const gap = computeGap(restored, devices)
  printGap(restored, gap, flag(argv, '--list'))
  const planFile = arg(argv, '--plan')[0] ?? 'gap-plan.json'
  fs.writeFileSync(planFile, JSON.stringify({
    createdAt: new Date().toISOString(), restoredFile, restoredDbId: restored.dbId, devices: deviceFiles,
    insert: gap.insert.map(toRow), conflicts: gap.conflicts,
  }, null, 1))
  console.log(`\nNOTHING was written to any database. The plan was saved to ${planFile} (review it, then run apply).`)
  return gap
}

const cli = (cwd, args) => execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'dexie-cloud', ...args], { cwd, stdio: 'inherit', shell: process.platform === 'win32' })

const apply = async (argv) => {
  const planFile = arg(argv, '--plan')[0]
  const cwd = path.resolve(arg(argv, '--cwd')[0] ?? '.')
  const dry = flag(argv, '--dry')
  if (!planFile) throw new Error('usage: apply --plan gap-plan.json --cwd <folder with dexie-cloud.json + dexie-cloud.key> [--dry]')
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(cwd, 'gap-logs')
  fs.mkdirSync(dir, { recursive: true })
  const log = (m) => { console.log(m); fs.appendFileSync(path.join(dir, `gap-${stamp}.log`), `${m}\n`) }

  // 1. safety export of the target as it is right now
  const safety = path.join(dir, `safety-before-${stamp}.zip`)
  log(`STEP 1 of 5 - safety export of the target database (reads only) -> ${safety}`)
  cli(cwd, ['export', safety])
  const before = await readSource(safety)
  log(`   target database: ${before.dbId} (exported ${before.exportedAt}); the plan was made from ${plan.restoredFile}`)

  // 2. re-check: nothing in the plan may already exist in the target, only eligible tables
  log('STEP 2 of 5 - re-check against the target as it is now')
  const insert = plan.insert.filter((r) => ELIGIBLE[r.table] && !(before.tables[r.table]?.has(String(r.id))))
  const dropped = plan.insert.length - insert.length
  const byTable = {}
  for (const r of insert) byTable[r.table] = (byTable[r.table] ?? 0) + 1
  log(`   ${insert.length} record(s) to insert (${Object.entries(byTable).map(([t, n]) => `${t} ${n}`).join(', ') || 'none'}); ${dropped} dropped because they already exist or are not an eligible table`)
  log(`   ${plan.conflicts.length} conflict(s) in the plan stay untouched`)
  if (insert.length === 0) { log('Nothing to insert. Done.'); return }

  // 3. typed confirmation
  // the phrase names the target database, so a wrong folder cannot be confirmed by habit
  const phrase = `INSERT ${insert.length} RECORDS INTO ${before.dbId}`
  log(`STEP 3 of 5 - confirmation (${dry ? 'DRY RUN: nothing will be written' : 'WRITES TO THE TARGET DATABASE'})`)
  const typed = await ask(`   Type exactly "${phrase}" to continue (anything else stops): `)
  if (typed.trim() !== phrase) { log('Stopped: the phrase did not match. Nothing was written.'); return }

  // 4. import ONLY the missing records
  const zip = new JSZip()
  const lines = [JSON.stringify({ type: 'header', version: 2, dbId: before.dbId, exportedAt: new Date().toISOString() })]
  if (before.schema) lines.push(JSON.stringify(before.schema))
  for (const r of insert) lines.push(JSON.stringify(r))
  zip.file('data.ndjson', lines.join('\n'))
  const importZip = path.join(dir, `gap-import-${stamp}.zip`)
  fs.writeFileSync(importZip, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  log(`STEP 4 of 5 - import of ONLY the missing records (${importZip})`)
  if (dry) { log('   dry run: the import was not run.'); return }
  cli(cwd, ['import', importZip])

  // 5. prove it: every inserted record is there, and nothing that existed changed
  log('STEP 5 of 5 - verify')
  const afterFile = path.join(dir, `after-${stamp}.zip`)
  cli(cwd, ['export', afterFile])
  const after = await readSource(afterFile)
  let missing = 0
  for (const r of insert) if (!after.tables[r.table]?.has(String(r.id))) missing += 1
  let changed = 0
  let removed = 0
  for (const [table, rows] of Object.entries(before.tables)) {
    for (const [id, data] of rows) {
      const now = after.tables[table]?.get(id)
      if (!now) removed += 1
      else if (stable(now) !== stable(data)) changed += 1
    }
  }
  const countsOk = Object.keys({ ...before.tables, ...after.tables }).every((t) => (after.tables[t]?.size ?? 0) - (before.tables[t]?.size ?? 0) === (byTable[t] ?? 0))
  log(`   inserted records found in the target: ${insert.length - missing} of ${insert.length}`)
  log(`   records that existed before and were CHANGED: ${changed}; REMOVED: ${removed}`)
  log(`   per-table counts grew by exactly the inserted numbers: ${countsOk ? 'yes' : 'NO - investigate'}`)
  log(missing === 0 && changed === 0 && removed === 0 && countsOk
    ? 'PASS. Next: open the app on a device, let derived totals recompute (they do on their own when the device is in sync), then check balances and next serial numbers.'
    : 'FAIL. Keep the safety export; do not continue until this is understood.')
}

const main = async () => {
  const [cmd, ...argv] = process.argv.slice(2)
  if (cmd === 'preview') await preview(argv)
  else if (cmd === 'apply') await apply(argv)
  else { console.log('usage: gap.mjs preview|apply  (see the header of this file)'); process.exit(cmd ? 1 : 0) }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('gap.mjs')) {
  main().catch((e) => { console.error(`\nERROR: ${e.message}`); process.exit(1) })
}
