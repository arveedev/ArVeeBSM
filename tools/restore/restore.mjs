#!/usr/bin/env node
// BSM RESTORE - one guided menu (backup-and-restore-plan.md section 8.6; screens as in docs/restore-script-samples.md).
//
// Run it from the repository folder on the owner's PC:
//   node tools/restore/restore.mjs --backups <folder with the backup zips> --cwd <folder holding the TARGET database's dexie-cloud.json + dexie-cloud.key>
//
// What it never does: it never deletes a record, never touches a database you did not point it at, and never writes
// without (1) a safety export, (2) a preview and (3) a phrase you type that names the database id.
// Every screen says whether it READS ONLY, WRITES TO A NEW DATABASE or WRITES TO THE LIVE DATABASE.
//
// Menu: 0 check a backup against the database | 1 repair in place | 2 rebuild into a new database |
//       3 recover the newest entries from devices | 4 switch back | 5 check the Google Sheet (not built yet) |
//       6 cloud is down | 9 my situation is not listed.
//
// Flags for rehearsals: --allow-nonempty (option 2 into a database that already holds data), --new-folder <folder>
// (option 2 into a database you already created there instead of running `npx dexie-cloud create`).

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import readline from 'node:readline'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { readSource } from '../gap-recovery/gap.mjs'
import { checkFile as checkDeviceFile } from '../device-file/verify.mjs'

export const REQUIRED_TABLES = ['users', 'warehouses', 'transactions', 'piles', 'authorities', 'reportConfig', 'settings', 'signatories', 'provinces', 'branches', 'varietyTypes', 'sackTypes']
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x))
const arg = (argv, name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const flag = (argv, name) => argv.includes(name)
const stampNow = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const pad = (s, n) => String(s).padEnd(n)
const num = (n) => Number(n).toLocaleString('en-US')

// ---------------------------------------------------------------- pure helpers (tested on their own)

/** Per table: what restoring `backup` onto `live` would ADD (id absent), UPDATE (id present, different) and leave. */
export const compareToLive = (backup, live) => {
  const out = {}
  const tables = new Set([...Object.keys(backup.tables), ...Object.keys(live.tables)])
  for (const t of tables) {
    if (t.startsWith('$')) continue
    const b = backup.tables[t] ?? new Map()
    const l = live.tables[t] ?? new Map()
    const r = { backup: b.size, live: l.size, add: [], update: [], same: 0, extra: 0 }
    for (const [id, data] of b) {
      if (!l.has(id)) r.add.push(id)
      else if (stable(l.get(id)) !== stable(data)) r.update.push(id)
      else r.same += 1
    }
    for (const id of l.keys()) if (!b.has(id)) r.extra += 1
    out[t] = r
  }
  return out
}

const toRow = (table, id, data) => {
  const { __realm, ...rest } = data
  return { type: 'row', realm: __realm ?? 'bsm-app-service@system.local', table, id, data: rest }
}

/** The records a repair would write (adds and updates only; nothing is ever deleted). */
export const repairRows = (backup, diff) => {
  const rows = []
  for (const [t, r] of Object.entries(diff)) for (const id of [...r.add, ...r.update]) rows.push(toRow(t, id, backup.tables[t].get(id)))
  return rows
}

/** Is the backup complete enough to trust? Returns { ok, problems[], warnings[] }. */
export const checkBackup = (src, { manifest = null, sha256 = null, previousTotal = null } = {}) => {
  const problems = []
  const warnings = []
  if (!src.dbId) problems.push('no header line in data.ndjson')
  if (!src.schema) problems.push('no schema line (the access setup would be lost)')
  for (const t of REQUIRED_TABLES) if (!(src.tables[t]?.size > 0)) problems.push(`required table "${t}" is missing or empty`)
  if (!(src.tables.realms?.size > 0)) problems.push('the access setup (realms) is missing')
  if (manifest?.sha256 && sha256 && manifest.sha256 !== sha256) problems.push('the SHA-256 does not match the manifest: the file changed after it was written')
  if (!manifest) warnings.push('no manifest file next to this backup (made before manifests existed): its hash is only recorded in the log')
  const total = Object.values(src.tables).reduce((s, m) => s + m.size, 0)
  if (previousTotal && total < previousTotal * 0.9) warnings.push(`it holds ${num(total)} objects, more than 10% fewer than the previous backup (${num(previousTotal)})`)
  return { ok: problems.length === 0, problems, warnings, total }
}

// ---------------------------------------------------------------- input / output

let rl = null
let lines = null
const openInput = () => {
  rl = readline.createInterface({ input: process.stdin, terminal: false })
  lines = rl[Symbol.asyncIterator]()
}
const closeInput = () => { rl?.close(); rl = null; lines = null }
const ask = async (q) => {
  if (!rl) openInput()
  process.stdout.write(q)
  const { value, done } = await lines.next()
  if (done) { console.log('\n(no more input: stopping safely)'); process.exit(0) }
  if (!process.stdin.isTTY) console.log(value)
  return String(value ?? '').trim()
}

let logFile = null
const out = (m = '') => { console.log(m); if (logFile) fs.appendFileSync(logFile, `${m}\n`) }
const header = (step, of, title, tag) => out(`\n STEP ${step} of ${of}  -  ${pad(title, 52)} [${tag}]\n`)
const READS = 'READS ONLY'
const NEWDB = 'WRITES TO NEW DATABASE'
const LIVE = 'WRITES TO THE LIVE DATABASE'

const dexie = (cwd, args) => {
  const r = spawnSync(NPX, ['--yes', 'dexie-cloud', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`dexie-cloud ${args[0]} failed${r.stderr ? `: ${String(r.stderr).split('\n').filter(Boolean).pop()}` : ''}`)
  return r.stdout
}

const dbInfo = (cwd) => {
  const f = path.join(cwd, 'dexie-cloud.json')
  if (!fs.existsSync(f)) throw new Error(`no dexie-cloud.json in ${cwd}`)
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'))
  return { url: cfg.dbUrl, id: new URL(cfg.dbUrl).hostname.split('.')[0] }
}

const sha256Of = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

const findBackups = (dir) => {
  const found = []
  const walk = (d, depth) => {
    if (depth > 4 || !fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/^(gap-logs|restore-logs|node_modules|\.git)$/.test(e.name)) walk(p, depth + 1) } else if (/^bsm-.*\d{4}-\d{2}-\d{2}.*\.zip$/i.test(e.name) && !/safety|after|before/i.test(e.name)) found.push(p)
    }
  }
  walk(dir, 0)
  return found.map((p) => ({ file: p, date: (p.match(/\d{4}-\d{2}-\d{2}/) ?? [''])[0] })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

const chooseBackup = async (backupsDir, step, of) => {
  header(step, of, 'Choose a backup', READS)
  const list = findBackups(backupsDir)
  if (list.length === 0) { out(`   No backup zips (bsm-YYYY-MM-DD.zip) found under ${backupsDir}.`); return null }
  out('   Available backups (newest first):')
  const infos = []
  for (const [i, b] of list.slice(0, 9).entries()) {
    const size = Math.round(fs.statSync(b.file).size / 1024)
    infos.push(b)
    out(`     ${i + 1}) ${b.date}   ${num(size)} KB   ${b.file}`)
  }
  const a = await ask(`\n   Choose 1-${infos.length}, or type a date (YYYY-MM-DD) >  `)
  const pick = /^\d+$/.test(a) ? infos[Number(a) - 1] : list.find((b) => b.date === a)
  if (!pick) { out('   Not a valid choice. Stopped, nothing was changed.'); return null }
  return pick
}

const loadAndCheck = async (pick) => {
  const src = await readSource(pick.file)
  const sha = sha256Of(pick.file)
  const mf = [pick.file.replace(/\.zip$/i, '.manifest.json'), path.join(path.dirname(pick.file), `${path.basename(pick.file, '.zip')}.manifest.json`)].find((f) => fs.existsSync(f))
  const manifest = mf ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null
  const res = checkBackup(src, { manifest, sha256: sha })
  out(`   Backup: ${pick.date}   ${res.total ? `${num(res.total)} objects` : ''}   sha256 ${sha.slice(0, 16)}...   ${res.ok ? 'all required tables present' : 'PROBLEM'}`)
  for (const w of res.warnings) out(`   note: ${w}`)
  for (const p of res.problems) out(`   PROBLEM: ${p}`)
  return { src, sha, res }
}

const checklist = async (items) => {
  out('   Before you start:')
  for (const it of items) out(`     [ ] ${it}`)
  const a = await ask('\n   Type  READY  to continue >  ')
  if (a !== 'READY') { out('   Stopped: nothing was changed.'); return false }
  return true
}

const diffTable = (diff, { only = null } = {}) => {
  out('   TABLE                    BACKUP     LIVE    ADD  UPDATE   (live-only)')
  let quiet = 0
  for (const [t, r] of Object.entries(diff).sort()) {
    if (only && !only(t, r)) continue
    if (r.add.length === 0 && r.update.length === 0 && r.backup === r.live) { quiet += 1; continue }
    out(`   ${pad(t, 22)} ${String(num(r.backup)).padStart(8)} ${String(num(r.live)).padStart(8)} ${String(r.add.length).padStart(6)} ${String(r.update.length).padStart(7)}   ${r.extra}`)
  }
  if (quiet) out(`   (${quiet} other tables: identical)`)
}

// ---------------------------------------------------------------- menu options

const optionCheck = async (ctx) => {
  logFile = path.join(ctx.logs, `check-${stampNow()}.txt`)
  const pick = await chooseBackup(ctx.backups, 1, 3)
  if (!pick) return
  header(2, 3, 'Compare with the database', READS)
  const { src, res } = await loadAndCheck(pick)
  const tmp = path.join(ctx.logs, `live-check-${stampNow()}.zip`)
  dexie(ctx.cwd, ['export', tmp])
  const live = await readSource(tmp)
  out(`   Database ${ctx.db.id}: ${num(Object.values(live.tables).reduce((s, m) => s + m.size, 0))} objects (exported ${live.exportedAt})\n`)
  const diff = compareToLive(src, live)
  diffTable(diff)
  header(3, 3, 'Done', READS)
  const adds = Object.values(diff).reduce((s, r) => s + r.add.length, 0)
  const upd = Object.values(diff).reduce((s, r) => s + r.update.length, 0)
  const extra = Object.values(diff).reduce((s, r) => s + r.extra, 0)
  out(`   Nothing was changed. The database lacks ${adds} object(s) the backup has, holds ${upd} that differ from the backup, and has ${extra} that the backup does not (normal: entries made after the backup).`)
  if (!res.ok) out('   WARNING: this backup failed its own check; do not restore from it.')
  out(`   Log saved: ${logFile}`)
}

const optionRepair = async (ctx) => {
  logFile = path.join(ctx.logs, `repair-${stampNow()}.txt`)
  out('\n  REPAIR IN PLACE adds and updates records; it never deletes, and it cannot be undone automatically.')
  out('  Anything doubtful should use option 2 (rebuild into a new database) instead.')
  header(1, 7, 'Before you start (checklist)', READS)
  if (!(await checklist(['Warehouse users have paused entries (or it is outside working hours)', 'No device has been cleared, reinstalled or logged out', 'You have chosen the right backup date']))) return
  const pick = await chooseBackup(ctx.backups, 2, 7)
  if (!pick) return
  const { src, res } = await loadAndCheck(pick)
  if (!res.ok) { out('\n   STOPPED. This backup failed its check. Nothing was changed.'); return }
  header(3, 7, 'Take a safety export', READS)
  const safety = path.join(ctx.logs, `before-restore-${stampNow()}.zip`)
  dexie(ctx.cwd, ['export', safety])
  const before = await readSource(safety)
  out(`   Saved: ${safety}   (${num(Object.values(before.tables).reduce((s, m) => s + m.size, 0))} objects). If this restore goes wrong, this file is your fallback.`)
  if (before.dbId !== ctx.db.id) { out(`   STOPPED: the export says database ${before.dbId} but dexie-cloud.json says ${ctx.db.id}.`); return }
  header(4, 7, 'Preview', READS)
  const diff = compareToLive(src, before)
  const rows = repairRows(src, diff)
  diffTable(diff, { only: (t, r) => r.add.length + r.update.length > 0 })
  out(`\n   If you continue the restore will ADD ${Object.values(diff).reduce((s, r) => s + r.add.length, 0)} and UPDATE ${Object.values(diff).reduce((s, r) => s + r.update.length, 0)} record(s).`)
  out('   It will NOT delete anything. Records that exist now but are not in the backup stay.')
  if (rows.length === 0) { out('\n   Nothing to restore: the database already matches the backup for every record in it. Done.'); return }
  if ((await ask('\n   Look correct? (yes / no) >  ')).toLowerCase() !== 'yes') { out('   Stopped: nothing was changed.'); return }
  header(5, 7, 'Confirm', LIVE)
  out(`   This changes REAL data in database ${ctx.db.id} (${ctx.db.url}).\n   Safety export taken: ${safety}`)
  const phrase = `RESTORE INTO ${ctx.db.id}`
  if ((await ask(`\n   Type this phrase exactly to continue:   ${phrase}\n   > `)) !== phrase) { out('   Stopped: the phrase did not match. Nothing was changed.'); return }
  header(6, 7, 'Restoring', LIVE)
  const zip = new JSZip()
  zip.file('data.ndjson', [JSON.stringify({ type: 'header', version: 2, dbId: before.dbId, exportedAt: new Date().toISOString() }), JSON.stringify(before.schema), ...rows.map((r) => JSON.stringify(r))].join('\n'))
  const importZip = path.join(ctx.logs, `repair-import-${stampNow()}.zip`)
  fs.writeFileSync(importZip, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  dexie(ctx.cwd, ['import', importZip])
  out('   Importing ...  done')
  header(7, 7, 'Check the result', READS)
  const afterFile = path.join(ctx.logs, `after-restore-${stampNow()}.zip`)
  dexie(ctx.cwd, ['export', afterFile])
  const after = await readSource(afterFile)
  let bad = 0
  for (const r of rows) if (stable(after.tables[r.table]?.get(String(r.id)) ?? null) !== stable(src.tables[r.table].get(String(r.id)))) bad += 1
  let disturbed = 0
  const touched = new Set(rows.map((r) => `${r.table}|${r.id}`))
  for (const [t, m] of Object.entries(before.tables)) for (const [id, d] of m) if (!touched.has(`${t}|${id}`) && stable(after.tables[t]?.get(id) ?? null) !== stable(d)) disturbed += 1
  out(`   restored records that now match the backup: ${rows.length - bad} of ${rows.length}`)
  out(`   records outside the restore that changed: ${disturbed}`)
  if (bad === 0 && disturbed === 0) {
    out('\n   RESULT: SUCCESS.\n   Next: ask a user to refresh, and spot-check a record you know.')
  } else {
    out(`\n   RESULT: PROBLEM  -  ${bad} restored record(s) did not match, ${disturbed} other record(s) changed.\n   Nothing more has been done. Your safety export: ${safety}\n   This method cannot be undone automatically; for an exact return, run option 2 with the safety export as the backup.`)
  }
  out(`   Log saved: ${logFile}`)
}

const optionRebuild = async (ctx) => {
  logFile = path.join(ctx.logs, `rebuild-${stampNow()}.txt`)
  out('\n  REBUILD INTO A NEW DATABASE: the current database is never touched, so there is nothing to undo.')
  header(1, 9, 'Before you start (checklist)', READS)
  if (!(await checklist(['Users have paused entries', 'No device has been cleared, reinstalled or logged out', 'You can receive e-mail at the Dexie manager address (a one-time code is sent)', 'You know which backup date to use']))) return
  const pick = await chooseBackup(ctx.backups, 2, 9)
  if (!pick) return
  const { src, sha, res } = await loadAndCheck(pick)
  if (!res.ok) { out('\n   STOPPED. This backup failed its check. Nothing was switched or created.'); return }
  header(3, 9, 'Safety export of the current database', READS)
  try {
    const safety = path.join(ctx.logs, `before-rebuild-${stampNow()}.zip`)
    dexie(ctx.cwd, ['export', safety])
    out(`   Saved: ${safety}`)
  } catch (e) { out(`   The current database is not reachable (${e.message}). Skipping: there is nothing to save.`) }

  header(4, 9, 'Create the new database', NEWDB)
  let newFolder = ctx.newFolder
  if (newFolder && fs.existsSync(path.join(newFolder, 'dexie-cloud.json'))) {
    out(`   Using the database already created in ${newFolder} (rehearsal mode).`)
  } else {
    newFolder = path.resolve(ctx.cwd, '..', `bsm-new-${stampNow()}`)
    fs.mkdirSync(newFolder, { recursive: true })
    out(`   A one-time code will be sent to your Dexie manager e-mail. Type the e-mail and then the code when asked.\n   (the new database's files will be saved in ${newFolder})\n`)
    closeInput()
    const r = spawnSync(NPX, ['--yes', 'dexie-cloud', 'create'], { cwd: newFolder, stdio: 'inherit', shell: process.platform === 'win32' })
    if (r.status !== 0) { out('   STOPPED. The new database was not created. Nothing was switched.'); return }
    openInput()
  }
  const nd = dbInfo(newFolder)
  if (nd.id === ctx.db.id) { out('   STOPPED: the "new" database is the old one. Nothing was written.'); return }
  out(`   New database: ${nd.url}\n   The OLD database (${ctx.db.url}) was not touched.`)

  header(5, 9, 'Set up access on the new database', NEWDB)
  const origins = (await ask('   Web address(es) the app runs on, separated by commas (blank = skip) >  ')).split(',').map((s) => s.trim()).filter(Boolean)
  for (const o of origins) { dexie(newFolder, ['whitelist', o]); out(`   Allowed ${o}  done`) }
  out(`   The app's access key (client id and secret) is in ${path.join(newFolder, 'dexie-cloud.key')}. Keep that file private.`)

  header(6, 9, 'Load the backup', NEWDB)
  const probe = path.join(ctx.logs, `new-before-${stampNow()}.zip`)
  dexie(newFolder, ['export', probe])
  const fresh = await readSource(probe)
  const existing = Object.entries(fresh.tables).filter(([t, m]) => m.size > 0 && !['realms', 'members', 'roles'].includes(t)).reduce((s, [, m]) => s + m.size, 0)
  if (existing > 0 && !ctx.allowNonEmpty) { out(`   STOPPED: the new database already holds ${existing} record(s). A rebuild needs an empty database. Nothing was loaded.`); return }
  dexie(newFolder, ['import', pick.file])
  out(`   Importing ${pick.date} backup into the new database ...  done`)

  header(7, 9, 'Check the new database', READS)
  const checkFile = path.join(ctx.logs, `new-after-${stampNow()}.zip`)
  dexie(newFolder, ['export', checkFile])
  const nu = await readSource(checkFile)
  const diff = compareToLive(src, nu)
  let mismatched = 0
  let missing = 0
  for (const r of Object.values(diff)) { mismatched += r.update.length; missing += r.add.length }
  diffTable(diff)
  const sample = []
  for (const t of REQUIRED_TABLES) { const ids = [...(src.tables[t]?.keys() ?? [])]; if (ids.length) sample.push([t, ids[Math.floor(ids.length / 2)]]) }
  const sampleOk = sample.filter(([t, id]) => stable(nu.tables[t]?.get(id) ?? null) === stable(src.tables[t].get(id))).length
  out(`\n   Spot-check: ${sampleOk} of ${sample.length} sample records (one from each required table) match field by field`)
  const exact = missing === 0 && mismatched === 0 && sampleOk === sample.length
  out(exact ? '\n   RESULT: the new database matches the backup exactly.' : `\n   RESULT: PROBLEM - ${missing} record(s) missing and ${mismatched} different in the new database.`)
  if (!exact) { out('   STOPPED. Nothing was switched; the live system is exactly as it was.'); return }

  header(8, 9, 'Switch the system to the new database', 'YOU DO THIS')
  out('   The tool cannot do this part. Do these in order:\n')
  out('   1. Vercel -> Project -> Settings -> Environment Variables. Set:')
  out(`        DEXIE_CLOUD_DB_URL        = ${nd.url}`)
  out(`        DEXIE_CLOUD_CLIENT_ID     = (the clientId in ${path.join(newFolder, 'dexie-cloud.key')})`)
  out(`        DEXIE_CLOUD_CLIENT_SECRET = (the clientSecret in the same file)`)
  out(`   2. Set the app's database address (src/db/dexie.js, databaseUrl) to ${nd.url}.`)
  out('   3. Redeploy.')
  out('   Each device then needs: Admin > Backup > Export All Data, clear its local data once, and sign in again.')
  out('   (a device stays tied to the database it first synced with and the new one refuses it until it is cleared)')
  if ((await ask('\n   Type  DONE  when you have finished all three >  ')) !== 'DONE') { out('   Not confirmed. The new database is ready and the old one is untouched; run this step by hand when ready.') }
  header(9, 9, 'Test, then tell users', READS)
  out('   Sign in on ONE test device. Check Home, Piles and Reports.\n   Next:\n     - Tell users to export, clear and sign in again.\n     - If entries were made after the backup: run option 3 (recover from devices) BEFORE devices are cleared.\n     - Check the Google Sheet (option 5).\n     - KEEP the old database untouched until you are sure.')
  out(`\n   RESULT: SUCCESS.   Log saved: ${logFile}`)
  out(`   Old database: ${ctx.db.url}   (hash of the backup used: ${sha.slice(0, 16)}...)`)
}

/** Device files in a folder: for each PC only its NEWEST daily .json.gz (older days are subsets), plus plain Export All Data .json files. */
export const deviceFilesIn = (dir) => {
  const names = fs.readdirSync(dir)
  const newest = new Map()
  for (const f of names.filter((n) => n.endsWith('.json.gz'))) {
    const m = f.match(/^(.*)-(\d{4}-\d{2}-\d{2})\.json\.gz$/)
    const key = m ? m[1] : f
    const date = m ? m[2] : ''
    if (!newest.has(key) || date > newest.get(key).date) newest.set(key, { f, date })
  }
  const plain = names.filter((n) => n.endsWith('.json') && !n.endsWith('.manifest.json') && n !== 'bsm-device.json')
  return [...[...newest.values()].map((x) => x.f), ...plain].map((f) => path.join(dir, f))
}

const optionDevices = async (ctx) => {
  logFile = path.join(ctx.logs, `devices-${stampNow()}.txt`)
  header(1, 3, 'Before you start', READS)
  if (!(await checklist(['Option 2 (rebuild) is finished and checked', 'No device has been cleared or reinstalled yet', 'You exported each device (Admin > Backup > Export All Data) and put the files in one folder']))) return
  const dir = await ask('\n   Folder with the device files (.json.gz from the PCs, or Export All Data .json) >  ')
  const found = fs.existsSync(dir) ? deviceFilesIn(dir) : []
  // a damaged device file is skipped with the reason, never merged and never allowed to stop the others
  const files = []
  for (const f of found) {
    if (!f.endsWith('.gz')) { files.push(f); continue }
    const r = await checkDeviceFile(f)
    if (r.ok) files.push(f)
    else out(`   SKIPPED ${path.basename(f)} - it failed its check: ${r.problems.join('; ')}`)
  }
  if (files.length === 0) { out('   No usable device files there. Stopped, nothing was changed.'); return }
  out(`   Using ${files.length} file(s): ${files.map((f) => path.basename(f)).join(', ')}`)
  header(2, 3, 'Preview (uses the gap recovery tool)', READS)
  const tmp = path.join(ctx.logs, `devices-current-${stampNow()}.zip`)
  dexie(ctx.cwd, ['export', tmp])
  const plan = path.join(ctx.logs, `gap-plan-${stampNow()}.json`)
  const gap = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gap-recovery', 'gap.mjs')
  const args = [gap, 'preview', '--restored', tmp, '--plan', plan]
  for (const f of files) args.push('--device', f)
  spawnSync(process.execPath, args, { stdio: 'inherit' })
  if ((await ask('\n   Add the missing records shown above? (yes / no) >  ')).toLowerCase() !== 'yes') { out('   Stopped: nothing was changed.'); return }
  header(3, 3, 'Add the missing records (safety export, typed phrase, proof)', LIVE)
  closeInput()
  spawnSync(process.execPath, [gap, 'apply', '--plan', plan, '--cwd', ctx.cwd], { stdio: 'inherit' })
  openInput()
  out(`   Log saved: ${logFile}`)
}

const textScreen = (title, body) => { out(`\n ${title}\n`); out(body) }

const main = async () => {
  const argv = process.argv.slice(2)
  const cwd = path.resolve(arg(argv, '--cwd') ?? '.')
  const backups = path.resolve(arg(argv, '--backups') ?? process.env.BSM_BACKUPS ?? '.')
  const db = dbInfo(cwd)
  const logs = path.join(cwd, 'restore-logs')
  fs.mkdirSync(logs, { recursive: true })
  const ctx = { cwd, backups, db, logs, allowNonEmpty: flag(argv, '--allow-nonempty'), newFolder: arg(argv, '--new-folder') ? path.resolve(arg(argv, '--new-folder')) : null }
  openInput()
  for (;;) {
    logFile = null
    console.log(`
 =====================================================================
  BSM RESTORE                                      database: ${db.id}
 =====================================================================
  What is wrong?

   0)  I only want to CHECK a backup against the database   (changes nothing)
   1)  Some records are missing or wrong, but the database mostly works  -> REPAIR in place
   2)  The database is badly damaged, or gone  -> REBUILD into a new database   (recommended for anything serious)
   3)  The database was lost and the newest entries exist only on devices  -> RECOVER from devices   (run AFTER option 2)
   4)  I rebuilt into a new database and want to GO BACK to the old one
   5)  Check the Google Sheet against the database   (not built yet)
   6)  The cloud is just unreachable / down  -> what to do
   9)  My situation is not listed  -> STOP and get help
   q)  Quit
`)
    const choice = (await ask('  Type a number >  ')).toLowerCase()
    try {
      if (choice === '0') await optionCheck(ctx)
      else if (choice === '1') await optionRepair(ctx)
      else if (choice === '2') await optionRebuild(ctx)
      else if (choice === '3') await optionDevices(ctx)
      else if (choice === '4') textScreen('SWITCH BACK to the old database', `   Use this only after option 2, if the new database turns out to be wrong. The old database was never changed.\n   Anything entered on the NEW database since the switch will not be on the old one (it stays safe in the new one).\n\n   1. Vercel -> Environment Variables: set the three values back to the OLD database (url, client id, client secret from your saved old key file).\n   2. Set the app's database address (src/db/dexie.js, databaseUrl) back to the old address.\n   3. Redeploy.\n   Devices that already signed in to the new database must export, clear their local data and sign in again (they are bound to the new one).\n   This database's address, for reference: ${db.url}`)
      else if (choice === '5') textScreen('CHECK THE GOOGLE SHEET', '   Not built yet (plan phase 7c). After any restore, compare the Sheet by hand for the days around the restore and use the app\'s "Force Sync Now" for records that show as not pushed.')
      else if (choice === '6') textScreen('THE CLOUD IS UNREACHABLE', '   Nothing to restore. Devices keep working offline and sync by themselves when the database is reachable again.\n   Do NOT clear, reinstall or log out any device. Check https://status.dexie.cloud and your internet connection, then wait.')
      else if (choice === '9') textScreen('NOT LISTED', '   STOP. Do not run anything. Write down what you see (take a screenshot) and get help before changing any data.')
      else if (choice === 'q' || choice === 'quit') break
      else console.log('  Not a choice.')
    } catch (e) {
      out(`\n  STOPPED: ${e.message}\n  Nothing further was done.`)
    }
  }
  closeInput()
}

if (process.argv[1]?.endsWith('restore.mjs')) main().catch((e) => { console.error(`\nERROR: ${e.message}`); process.exit(1) })
