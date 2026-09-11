#!/usr/bin/env node
// sync-version.cjs — writes public/version.json from src/version.js's own
// APP_VERSION export, run before every dev/build (see package.json).
//
// This exists for the in-app "a new version is available" check
// (src/components/common/UpdateChecker.jsx): that component polls
// version.json (a plain static file, fetched with cache: 'no-store' so it
// always reflects what's actually deployed) and compares it against the
// version baked into the currently-running JS bundle. version.json has to
// be regenerated on every build - a stale one would either never notice a
// real update, or wrongly claim one exists forever - so this reads the
// single source of truth (src/version.js) instead of being hand-maintained
// as a second copy that could drift from it.

const fs = require('fs')
const path = require('path')

const versionSource = fs.readFileSync(path.join(__dirname, 'src', 'version.js'), 'utf8')
const match = versionSource.match(/export const APP_VERSION = '([^']+)'/)

if (!match) {
  console.error('✗ sync-version: could not find APP_VERSION in src/version.js')
  process.exit(1)
}

const version = match[1]
fs.writeFileSync(
  path.join(__dirname, 'public', 'version.json'),
  JSON.stringify({ version }) + '\n'
)
console.log(`✓ public/version.json synced to ${version}`)
