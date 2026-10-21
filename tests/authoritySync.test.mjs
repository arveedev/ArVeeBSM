// Guards for the authority sync (the Google Sheet AI/SIA pull). Missing authorities once came from one oversized request that failed
// every time; these checks keep the protections in place.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const bridge = fs.readFileSync(path.join(root, 'src', 'services', 'googleSheetsBridge.js'), 'utf8')
const script = fs.readFileSync(path.join(root, 'docs', 'apps-script-full-replacement.js'), 'utf8')

test('the authority pull is paged and the page shrinks when one will not come through', () => {
  assert.ok(/AUTHORITY_PAGE\s*=\s*\d+/.test(bridge))
  assert.ok(/searchParams\.set\('limit'/.test(bridge) && /hasMore/.test(bridge))
  assert.ok(/size = Math\.max\(20, Math\.floor\(size \/ 2\)\)/.test(bridge))
})

test('a full pull is forced at least every 12 hours, and one failed side or one bad authority never stops the rest', () => {
  assert.ok(/FULL_EVERY_MS\s*=\s*12 \* 3600 \* 1000/.test(bridge))
  assert.ok(/Promise\.allSettled/.test(bridge))
  assert.ok(/could not save SIA/.test(bridge) && /could not save AI/.test(bridge))
})

test('a failing sync is recorded on the sheet source so the app can warn, and the warning component reads it', () => {
  assert.ok(/authoritySyncError/.test(bridge) && /lastAuthoritySyncOkAt/.test(bridge))
  const alert = fs.readFileSync(path.join(root, 'src', 'components', 'common', 'AuthoritySyncAlert.jsx'), 'utf8')
  assert.ok(/authoritySyncError/.test(alert))
})

test('the Apps Script answers fetchAuthorities a page at a time', () => {
  const at = script.indexOf("action !== 'fetchAuthorities'")
  const tail = script.slice(at)
  assert.ok(/offset/.test(tail) && /hasMore/.test(tail))
})
