#!/usr/bin/env node
// REHEARSAL helper: turns a Dexie Cloud export (.zip) into a device backup file, so the tools can be rehearsed on real-shaped
// data before any PC has produced one. The records are the export's own; the header says it came from "rehearsal device".
//   node tools/device-file/rehearsal-make.mjs <export.zip> <out.json.gz> [--pending N]
import fs from 'node:fs'
import zlib from 'node:zlib'
import JSZip from 'jszip'
import { buildDeviceFileText } from '../../src/utils/deviceFile.js'

const [src, out] = process.argv.slice(2)
const flagAt = process.argv.indexOf('--pending')
const pendingN = flagAt > 0 ? Number(process.argv[flagAt + 1]) || 0 : 0
const zip = await JSZip.loadAsync(fs.readFileSync(src))
const name = Object.keys(zip.files).find((n) => n.endsWith('.ndjson'))
const tables = {}
let dbId = ''
let keys = {}
let exportedAt = new Date().toISOString()
for (const line of (await zip.files[name].async('string')).split('\n')) {
  if (!line.trim()) continue
  const r = JSON.parse(line)
  if (r.type === 'header') { dbId = r.dbId; exportedAt = r.exportedAt } else if (r.type === 'schema') keys = r.tables
  else if (r.table) {
    // a cloud export keeps the primary key outside the record; a device's own copy has it inside, so put it back
    const pk = keys[r.table]?.replace(/^[@+]/, '')
    ;(tables[r.table] ??= []).push({ ...(pk && /^\w+$/.test(pk) ? { [pk]: r.id } : {}), ...r.data, ...(r.realm ? { realmId: r.realm } : {}) })
  }
}
const { text } = await buildDeviceFileText({
  deviceId: 'rehearsal-0001', deviceName: 'rehearsal device', user: 'Rehearsal', appVersion: '1.10-test', schemaVersion: 48, dbId,
  lastSyncAt: exportedAt, pending: pendingN ? { transactions: pendingN } : {},
}, tables, { exportedAt, databaseName: 'BSMDatabase' })
fs.writeFileSync(out, zlib.gzipSync(Buffer.from(text, 'utf8')))
console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${Object.values(tables).reduce((n, r) => n + r.length, 0)} records)`)
