// Net Equivalent Net Weight (ENW) Factor Table — Admin only.
//
// One row per (Purity letter, D&D bracket, MC bracket) -> factor. A
// Palay variety's own fixed Purity letter / D&D bracket (see
// VarietyTypesPanel.jsx) already picks which rows apply to it; a
// Purchase Receipt's WSR's own Moisture Content picks the MC bracket
// among those. See src/utils/sdoCalculations.js's lookupEnwFactor for
// the actual runtime lookup this table drives.
//
// Displayed as a real grid (D&D/Purity down the side, MC bracket across
// the top, factor in each cell) rather than 68 separate list rows -
// matches the reference sheet's own layout and is how this was shown
// during planning, confirmed directly as the wanted shape.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Trash2 } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { secondaryButtonClass } from './shared.js'

// The exact reference sheet already shared for this feature - 17 MC
// brackets x 2 Purity letters x 2 D&D brackets. Seeded in one tap
// instead of asking Admin to retype 68 values by hand. (One value
// corrected against the sheet's own decreasing trend: D&D 3.1-7%/
// Purity A's MC 24.1-25% cell read "0.07417" in the source - a 10x
// outlier next to 0.7533 and 0.73 either side of it - almost certainly
// a copy artifact for 0.7417, which fits the trend exactly and is used
// here; flagged so Admin can double check against the physical sheet.)
const MC_BRACKETS = [
  [11, 14], [14.1, 15], [15.1, 16], [16.1, 17], [17.1, 18], [18.1, 19], [19.1, 20],
  [20.1, 21], [21.1, 22], [22.1, 23], [23.1, 24], [24.1, 25], [25.1, 26], [26.1, 27],
  [27.1, 28], [28.1, 29], [29.1, 30],
]
const REFERENCE_ROWS = [
  { purityLetter: 'A', ddMin: 0, ddMax: 3, factors: [1, 0.9797, 0.9594, 0.939, 0.9187, 0.8984, 0.8781, 0.8577, 0.8374, 0.8171, 0.7968, 0.7851, 0.7735, 0.7619, 0.7503, 0.7386, 0.727] },
  { purityLetter: 'B', ddMin: 0, ddMax: 3, factors: [0.91, 0.8915, 0.873, 0.8545, 0.836, 0.8175, 0.799, 0.7805, 0.762, 0.7436, 0.7251, 0.7145, 0.7039, 0.6933, 0.6827, 0.6721, 0.6616] },
  { purityLetter: 'A', ddMin: 3.1, ddMax: 7, factors: [0.9565, 0.9362, 0.9159, 0.8956, 0.8752, 0.8549, 0.8346, 0.8143, 0.7939, 0.7736, 0.7533, 0.7417, 0.73, 0.7184, 0.7068, 0.6951, 0.6835] },
  { purityLetter: 'B', ddMin: 3.1, ddMax: 7, factors: [0.8665, 0.8481, 0.8297, 0.8113, 0.7929, 0.7745, 0.7561, 0.7376, 0.7192, 0.7008, 0.6824, 0.6619, 0.6613, 0.6508, 0.6403, 0.6297, 0.6192] },
]

const rowKeyOf = (r) => `${r.ddMin}|${r.ddMax}|${r.purityLetter}`
const colKeyOf = (r) => `${r.mcMin}|${r.mcMax}`

function EnwFactorTablePanel() {
  const [confirmingSeed, setConfirmingSeed] = useState(false)
  const [pendingDeleteRowKey, setPendingDeleteRowKey] = useState(null)
  // New-bracket form - only needed to introduce a D&D/Purity combo or
  // an MC bracket that doesn't exist in the grid yet; every other edit
  // happens directly in a grid cell.
  const [showAddForm, setShowAddForm] = useState(false)
  const [newBracket, setNewBracket] = useState({ purityLetter: '', ddMin: '', ddMax: '', mcMin: '', mcMax: '', factor: '' })

  const rows = useLiveQuery(() => db.enwFactors.toArray(), []) ?? []

  const cellByKey = new Map(rows.map((r) => [`${rowKeyOf(r)}::${colKeyOf(r)}`, r]))
  const rowDefs = [...new Map(rows.map((r) => [rowKeyOf(r), { ddMin: r.ddMin, ddMax: r.ddMax, purityLetter: r.purityLetter }])).values()]
    .sort((a, b) => a.ddMin - b.ddMin || a.purityLetter.localeCompare(b.purityLetter))
  const colDefs = [...new Map(rows.map((r) => [colKeyOf(r), { mcMin: r.mcMin, mcMax: r.mcMax }])).values()]
    .sort((a, b) => a.mcMin - b.mcMin)

  // Idempotent by (purityLetter, ddMin, ddMax, mcMin, mcMax): an
  // existing cell is updated in place (or left alone if the factor
  // already matches) instead of getting a second row added next to it.
  // This used to be a genuine footgun - the seed button stayed visible
  // and re-runnable even with rows already present, and its own confirm
  // text had to warn "re-running this adds duplicates, so use it once"
  // because lookupEnwFactor's plain `.find()` would then silently pick
  // whichever duplicate happened to sort first. Safe to tap any number
  // of times now.
  const handleSeed = async () => {
    setConfirmingSeed(false)
    const seedRows = REFERENCE_ROWS.flatMap(({ purityLetter, ddMin, ddMax, factors }) =>
      factors.map((factor, i) => ({
        purityLetter, ddMin, ddMax,
        mcMin: MC_BRACKETS[i][0], mcMax: MC_BRACKETS[i][1],
        factor,
      }))
    )
    let added = 0
    let updated = 0
    for (const seed of seedRows) {
      const key = `${rowKeyOf(seed)}::${colKeyOf(seed)}`
      const matches = rows.filter((r) => `${rowKeyOf(r)}::${colKeyOf(r)}` === key)
      if (matches.length === 0) {
        await db.enwFactors.add({ id: crypto.randomUUID(), ...seed })
        added += 1
      } else {
        // Any stray duplicates already on this cell collapse down to
        // one row, keeping the first and clearing the rest, so a prior
        // bad reseed self-heals the next time this runs.
        const [keep, ...extra] = matches
        if (extra.length > 0) await db.enwFactors.bulkDelete(extra.map((r) => r.id))
        if (keep.factor !== seed.factor) {
          await db.enwFactors.update(keep.id, { factor: seed.factor })
          updated += 1
        }
      }
    }
    toast.success(added > 0 || updated > 0 ? `${added} added, ${updated} updated` : 'Already up to date')
  }

  const handleCellBlur = async (rowDef, colDef, rawValue) => {
    const key = `${rowKeyOf(rowDef)}::${colKeyOf(colDef)}`
    const existing = cellByKey.get(key)
    const trimmed = rawValue.trim()
    if (trimmed === '') {
      if (existing) await db.enwFactors.delete(existing.id)
      return
    }
    const factor = parseFloat(trimmed)
    if (Number.isNaN(factor)) return
    if (existing) {
      if (existing.factor !== factor) await db.enwFactors.update(existing.id, { factor })
    } else {
      await db.enwFactors.add({
        id: crypto.randomUUID(),
        purityLetter: rowDef.purityLetter, ddMin: rowDef.ddMin, ddMax: rowDef.ddMax,
        mcMin: colDef.mcMin, mcMax: colDef.mcMax,
        factor,
      })
    }
  }

  const handleAddBracket = async () => {
    const { purityLetter, ddMin, ddMax, mcMin, mcMax, factor } = newBracket
    if (!purityLetter.trim() || ddMin === '' || ddMax === '' || mcMin === '' || mcMax === '' || factor === '') {
      toast.error('All fields are required')
      return
    }
    const mcMinNum = parseFloat(mcMin)
    const mcMaxNum = parseFloat(mcMax)
    // lookupEnwFactor matches inclusively and takes the FIRST row that
    // fits an MC value - two brackets overlapping (even partially) makes
    // that pick order-dependent instead of a real rule, so this is
    // blocked here rather than left as a silent footgun for whoever
    // types the next bracket.
    const overlapsExisting = colDefs.some((c) => !(mcMaxNum < c.mcMin || mcMinNum > c.mcMax) && !(mcMinNum === c.mcMin && mcMaxNum === c.mcMax))
    if (overlapsExisting) {
      toast.error('This MC range overlaps an existing bracket — use the exact same range to reuse it, or a non-overlapping one')
      return
    }
    await db.enwFactors.add({
      id: crypto.randomUUID(),
      purityLetter: purityLetter.trim().toUpperCase(),
      ddMin: parseFloat(ddMin), ddMax: parseFloat(ddMax),
      mcMin: parseFloat(mcMin), mcMax: parseFloat(mcMax),
      factor: parseFloat(factor),
    })
    setNewBracket({ purityLetter: '', ddMin: '', ddMax: '', mcMin: '', mcMax: '', factor: '' })
    setShowAddForm(false)
    toast.success('Bracket added')
  }

  const confirmDeleteRow = async () => {
    const rowDef = pendingDeleteRowKey
    setPendingDeleteRowKey(null)
    const idsToDelete = rows.filter((r) => rowKeyOf(r) === rowKeyOf(rowDef)).map((r) => r.id)
    await db.enwFactors.bulkDelete(idsToDelete)
    toast.success('Row deleted')
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">ENW Factor Table</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Admin only — MC bracket × Purity letter × D&D bracket → factor. Tap a cell to edit its factor directly.
      </p>

      {rowDefs.length === 0 ? (
        <button
          type="button"
          onClick={() => setConfirmingSeed(true)}
          className={`mt-3 w-full ${secondaryButtonClass}`}
        >
          Load Reference Table (17 MC brackets × 4 rows)
        </button>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-2 text-left font-semibold text-neutral-400">D&D / Purity</th>
                {colDefs.map((c) => (
                  <th key={colKeyOf(c)} className="whitespace-nowrap bg-neutral-950 px-2 py-2 text-center font-semibold text-neutral-400">
                    {c.mcMin}–{c.mcMax}
                  </th>
                ))}
                <th className="bg-neutral-950 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rowDefs.map((rowDef) => (
                <tr key={rowKeyOf(rowDef)} className="border-t border-neutral-800">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-900 px-3 py-1.5 font-medium text-app-text">
                    {rowDef.ddMin}–{rowDef.ddMax} / <span className="text-brand-neon">{rowDef.purityLetter}</span>
                  </td>
                  {colDefs.map((colDef) => {
                    const cell = cellByKey.get(`${rowKeyOf(rowDef)}::${colKeyOf(colDef)}`)
                    return (
                      <td key={colKeyOf(colDef)} className="px-1 py-1">
                        <input
                          type="number"
                          step="0.0001"
                          defaultValue={cell?.factor ?? ''}
                          key={cell?.factor ?? 'empty'}
                          onBlur={(e) => handleCellBlur(rowDef, colDef, e.target.value)}
                          className="w-16 rounded-md border border-neutral-800 bg-neutral-950 px-1.5 py-1 text-center text-app-text outline-none transition-colors focus:border-brand-neon"
                        />
                      </td>
                    )
                  })}
                  <td className="px-1">
                    <button type="button" onClick={() => setPendingDeleteRowKey(rowDef)} aria-label="Delete this D&D/Purity row" className="rounded-md p-1.5 text-brand-crimson transition-transform active:scale-90">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        {rowDefs.length > 0 && (
          <button type="button" onClick={() => setConfirmingSeed(true)} className={secondaryButtonClass}>
            Reload Reference Table
          </button>
        )}
        <button type="button" onClick={() => setShowAddForm((v) => !v)} className={secondaryButtonClass}>
          {showAddForm ? 'Cancel' : '+ New bracket'}
        </button>
      </div>

      {showAddForm && (
        <div className="mt-3 space-y-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
          <p className="text-xs text-neutral-500">Adds a new D&D/Purity row or MC column the grid above doesn't have yet.</p>
          <div className="grid grid-cols-3 gap-2">
            <input type="text" maxLength={1} placeholder="Letter" value={newBracket.purityLetter} onChange={(e) => setNewBracket((f) => ({ ...f, purityLetter: e.target.value }))} className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-app-text outline-none focus:border-brand-neon" />
            <input type="number" placeholder="D&D min" value={newBracket.ddMin} onChange={(e) => setNewBracket((f) => ({ ...f, ddMin: e.target.value }))} className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-app-text outline-none focus:border-brand-neon" />
            <input type="number" placeholder="D&D max" value={newBracket.ddMax} onChange={(e) => setNewBracket((f) => ({ ...f, ddMax: e.target.value }))} className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-app-text outline-none focus:border-brand-neon" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input type="number" placeholder="MC min" value={newBracket.mcMin} onChange={(e) => setNewBracket((f) => ({ ...f, mcMin: e.target.value }))} className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-app-text outline-none focus:border-brand-neon" />
            <input type="number" placeholder="MC max" value={newBracket.mcMax} onChange={(e) => setNewBracket((f) => ({ ...f, mcMax: e.target.value }))} className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-app-text outline-none focus:border-brand-neon" />
            <input type="number" step="0.0001" placeholder="Factor" value={newBracket.factor} onChange={(e) => setNewBracket((f) => ({ ...f, factor: e.target.value }))} className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-app-text outline-none focus:border-brand-neon" />
          </div>
          <button type="button" onClick={handleAddBracket} className={`w-full ${secondaryButtonClass}`}>Add</button>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteRowKey !== null}
        title="Delete this row?"
        description="Removes this D&D/Purity row's factor across every MC bracket. This cannot be undone."
        onConfirm={confirmDeleteRow}
        onCancel={() => setPendingDeleteRowKey(null)}
      />

      <ConfirmDialog
        open={confirmingSeed}
        title="Load the reference ENW table?"
        description="Loads 68 rows (17 MC brackets × Purity A/B × D&D 0-3%/3.1-7%) from the reference sheet already provided for this feature. One value (D&D 3.1-7%, Purity A, MC 24.1-25%) was corrected from 0.07417 to 0.7417 to match the sheet's own decreasing trend either side of it - worth a quick check against the physical sheet. Safe to re-run: a cell that already matches is left alone, a cell that differs is updated to the reference value, nothing is duplicated."
        confirmLabel="Load Table"
        onConfirm={handleSeed}
        onCancel={() => setConfirmingSeed(false)}
      />
    </section>
  )
}

export default EnwFactorTablePanel
