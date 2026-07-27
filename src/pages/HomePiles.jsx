// Home Piles list — tap a pile to open the WSR/WSI/WTS action menu, tap
// its age to edit it directly. Pile card layout: Pile Name + Age on row
// 1; bags (prominent) + net bags (subtext) on the left of row 2, net
// kilos + avg weight/bag on the right.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSettings } from '../context/SettingsContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { db } from '../db/dexie.js'
import { calculateCurrentAge, calculateNetBags, calculateAverageWeightPerBag, fmtBags, fmtWeight, fmtNetBags, fmtAge } from '../utils/calculations.js'
import PileActionSheet from '../components/common/PileActionSheet.jsx'
import EditPileAgeDialog from '../components/common/EditPileAgeDialog.jsx'

const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })

function HomePiles() {
  const { autoAgeMonitoring, weightUnit } = useSettings() ?? {}
  const { currentWarehouseId } = useWarehouse() ?? {}

  const [openMenuPileId, setOpenMenuPileId] = useState(null)
  const [editingAgePile, setEditingAgePile] = useState(null)

  const piles = useLiveQuery(async () => {
    if (!currentWarehouseId) return []
    return db.piles.where('warehouseId').equals(currentWarehouseId).toArray()
  }, [currentWarehouseId]) ?? []

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))

  const pileList = [...piles].sort((a, b) => byAlpha(a.pileName, b.pileName))
  const enrichedPiles = pileList.map((p) => ({
    ...p,
    age: calculateCurrentAge(p.initialAgeValue ?? 0, p.dateOfReceipt, autoAgeMonitoring),
    variety: varietyMap.get(p.varietyId),
  }))

  const handlePileAction = (pile, type) => {
    setOpenMenuPileId(null)
    if (typeof window.openTransactionForm === 'function') {
      window.openTransactionForm(type, { pileId: pile.pileId, varietyId: pile.varietyId })
    }
  }

  return (
    <div className="mt-4">
      <p className="text-xs text-neutral-500">Tap a pile to record a receipt or issuance.</p>

      {pileList.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500">
          No piles recorded for this facility yet.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {enrichedPiles.map((p) => {
            const netBags = calculateNetBags(p.currentKilos ?? 0)
            const avgWeight = calculateAverageWeightPerBag(p.currentKilos ?? 0, p.currentBags ?? 0)

            return (
              <li key={p.pileId} className="relative">
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-3">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setOpenMenuPileId(p.pileId)}
                      className="flex-1 text-left text-sm font-medium text-app-text transition-opacity active:opacity-70"
                    >
                      {p.pileName}
                      {p.variety && <span className="ml-2 text-xs text-neutral-500">{p.variety.name}</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingAgePile({ pile: p, age: p.age })}
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-neutral-400 underline decoration-dotted underline-offset-2 transition-colors hover:text-app-text"
                    >
                      {fmtAge(p.age)} old
                    </button>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-base font-semibold text-app-text">
                      {fmtBags(p.currentBags ?? 0)} bags
                      <span className="ml-1.5 text-xs font-normal text-neutral-500">({fmtNetBags(netBags)} net bags)</span>
                    </span>
                    <span className="text-xs text-neutral-400">
                      Net {fmtWeight(p.currentKilos ?? 0, weightUnit)} ({avgWeight.toFixed(2)})
                    </span>
                  </div>
                </div>

                {openMenuPileId === p.pileId && (
                  <PileActionSheet
                    onSelect={(type) => handlePileAction(p, type)}
                    onClose={() => setOpenMenuPileId(null)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {editingAgePile && (
        <EditPileAgeDialog
          pile={editingAgePile.pile}
          currentAge={editingAgePile.age}
          onClose={() => setEditingAgePile(null)}
        />
      )}
    </div>
  )
}

export default HomePiles
