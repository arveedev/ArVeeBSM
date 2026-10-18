#!/usr/bin/env node
// Checks PC device backup files (the .json.gz files each office PC saves; see src/utils/deviceFile.js).
//
// USAGE:  node tools/device-file/verify.mjs <file.json.gz | folder> [more files or folders ...]
// Reads only. For each file says PASS or FAIL in plain words (checksum, record counts, database id) and prints who made it,
// when, and how many entries that PC still had waiting to send when it saved. Exit code 1 when any file fails.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { verifyDeviceFile } from '../../src/utils/deviceFile.js'

const collect = (p) => {
  const st = fs.statSync(p)
  if (!st.isDirectory()) return [p]
  return fs.readdirSync(p).filter((f) => f.endsWith('.json.gz')).sort().map((f) => path.join(p, f))
}

export const checkFile = async (file) => {
  let text
  try { text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8') } catch { return { file, ok: false, problems: ['not a readable gzip file (damaged or cut short)'] } }
  const v = await verifyDeviceFile(text)
  return { file, ...v }
}

const main = async () => {
  const args = process.argv.slice(2)
  if (args.length === 0) { console.log('usage: node tools/device-file/verify.mjs <file.json.gz | folder> [...]'); process.exit(2) }
  const files = args.flatMap(collect)
  if (files.length === 0) { console.log('No .json.gz files found.'); process.exit(1) }
  let bad = 0
  for (const f of files) {
    const r = await checkFile(f)
    if (r.ok) {
      const m = r.meta
      const pending = Object.values(m.pending ?? {}).reduce((a, b) => a + b, 0)
      const records = Object.values(m.counts ?? {}).reduce((a, b) => a + b, 0)
      console.log(`PASS  ${path.basename(f)}`)
      console.log(`      ${m.deviceName ?? '?'} - ${m.user || 'no user'} - app ${m.appVersion ?? '?'} - database ${m.dbId} - saved ${m.exportedAt} - ${records.toLocaleString('en-US')} records${pending ? ` - ${pending} entries were still waiting to send` : ''}`)
    } else {
      bad += 1
      console.log(`FAIL  ${path.basename(f)}`)
      for (const p of r.problems) console.log(`      - ${p}`)
    }
  }
  console.log(`\n${files.length - bad} of ${files.length} file(s) usable.${bad ? ' Do NOT restore from the failed ones.' : ''}`)
  process.exit(bad ? 1 : 0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main()
