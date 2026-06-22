#!/usr/bin/env node
// check-imports.js — validates every relative import/export path in src/
// actually resolves to a real file on disk. Zero dependencies (pure
// Node.js), so it runs even before `npm install`.
//
// This exists because of a real bug: a component was moved into a deeper
// folder (src/components/common/) without updating its relative import
// depth, so '../db/dexie.js' silently pointed at a path that doesn't
// exist instead of the correct '../../db/dexie.js'. Nothing caught this
// until `npm run dev` actually tried to load the file in a browser.
//
// Run with:  node check-imports.js
// Exits with code 1 if any broken import is found (suitable for CI / a
// pre-commit hook), code 0 if everything resolves.

const fs = require('fs')
const path = require('path')

const SRC_ROOT = path.join(__dirname, 'src')
const IMPORT_RE = /from\s+['"](\.[^'"]+)['"]/g

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(full, files)
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

function resolves(basePath) {
  const candidates = [basePath, `${basePath}.js`, `${basePath}.jsx`]
  return candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile())
}

const files = walk(SRC_ROOT)
const errors = []

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8')
  const dir = path.dirname(file)

  for (const match of content.matchAll(IMPORT_RE)) {
    const relImport = match[1]
    const resolved = path.normalize(path.join(dir, relImport))

    if (!resolves(resolved)) {
      errors.push({ file: path.relative(__dirname, file), import: relImport, resolved })
    }
  }
}

if (errors.length > 0) {
  console.error(`\n✗ Found ${errors.length} broken relative import(s):\n`)
  for (const e of errors) {
    console.error(`  ${e.file}`)
    console.error(`    imports "${e.import}" -> does not resolve to a real file\n`)
  }
  process.exit(1)
}

console.log(`✓ All relative imports in ${files.length} file(s) resolve correctly.`)
process.exit(0)
