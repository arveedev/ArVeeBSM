// Home — Dynamic Facility Status Core Overview (Step 4.4).
//
// Pile card layout: Pile Name on the left of the top row, Age on the
// right. Second row: Net Bags on the left, Net Kilos (avg weight/bag) on
// the right, formatted as "1,509.24 kg (52.04)" with no extra label text.
// Tapping the pile name/card opens the WSR/WSI/WTS action menu anchored
// to that card; tapping the age opens an Edit Age dialog.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../context/AuthContext.jsx'
import { useSettings } from '../context/SettingsContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { db } from '../db/dexie.js'
import { calculateCurrentAge, calculateNetBags, calculateAverageWeightPerBag } from '../utils/calculations.js'
import AuthorityMonitor from '../components/common/AuthorityMonitor.jsx'
import PileActionSheet from '../components/common/PileActionSheet.jsx'
import EditPileAgeDialog from '../components/common/EditPileAgeDialog.jsx'

const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })

function Home() {
  const { user } = useAuth()
  const { autoAgeMonitoring } = useSettings() ?? {}
  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } =
    useWarehouse() ?? {}

  const [openMenuPileId, setOpenMenuPileId] = useState(null)
  const [editingAgePile, setEditingAgePile] = useState(null)

  const piles = useLiveQuery(async () => {
    if (!currentWarehouseId) return []
    return db.piles.where('warehouseId').equals(currentWarehouseId).toArray()
  }, [currentWarehouseId])

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), [])
  const varietyMap = new Map((varieties ?? []).map((v) => [v.varietyId, v]))

  const pileList = [...(piles ?? [])].sort((a, b) => byAlpha(a.pileName, b.pileName))
  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  const totalBags = pileList.reduce((sum, p) => sum + (p.currentBags ?? 0), 0)
  const totalKilos = pileList.reduce((sum, p) => sum + (p.currentKilos ?? 0), 0)
  const totalNetBags = totalKilos / 50

  const handlePileAction = (pile, type) => {
    setOpenMenuPileId(null)
    if (typeof window.openTransactionForm === 'function') {
      window.openTransactionForm(type, {
        pileId: pile.pileId,
        varietyId: pile.varietyId,
      })
    }
  }

  return (
    <div className="min-h-screen px-4 pb-24 pt-6">
      <h1 className="text-xl font-semibold text-white">Home</h1>
      <p className="mt-1 text-sm text-neutral-400">Welcome back, {user?.nickname}.</p>

      {sortedWarehouses.length > 1 && (
        <div className="mt-4">
          <select
            value={currentWarehouseId ?? ''}
            onChange={(e) => setCurrentWarehouseId(e.target.value)}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-neon"
          >
            {sortedWarehouses.map((w) => (
              <option key={w.warehouseId} value={w.warehouseId}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {currentWarehouse ? (
        <p className="mt-3 text-xs text-neutral-500">
          {currentWarehouse.code} — {currentWarehouse.name}
        </p>
      ) : (
        <p className="mt-3 text-xs text-neutral-500">No warehouse assigned yet.</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <SummaryCard label="Total Bags" value={totalBags.toLocaleString()} />
        <SummaryCard label="Total Net Bags" value={totalNetBags.toFixed(2)} sub />
      </div>

      <AuthorityMonitor />

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-white">Piles</h2>
        <p className="mt-1 text-xs text-neutral-500">Tap a pile to record a receipt or issuance.</p>

        {pileList.length === 0 ? (
          <p className="mt-2 text-xs text-neutral-500">
            No piles recorded for this facility yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pileList.map((p) => {
              const age = calculateCurrentAge(
                p.initialAgeValue ?? 0,
                p.dateOfReceipt,
                autoAgeMonitoring
              )
              const netBags = calculateNetBags(p.currentKilos ?? 0)
              const avgWeight = calculateAverageWeightPerBag(p.currentKilos ?? 0, p.currentBags ?? 0)

              return (
                <li key={p.pileId} className="relative">
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-3">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setOpenMenuPileId(p.pileId)}
                        className="flex-1 text-left text-sm font-medium text-white transition-opacity active:opacity-70"
                      >
                        {p.pileName}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingAgePile({ pile: p, age })}
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-neutral-400 underline decoration-dotted underline-offset-2 transition-colors hover:text-white"
                      >
                        {age} days old
                      </button>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-neutral-300">
                        {(p.currentBags ?? 0).toLocaleString()} bags
                        <span className="ml-1 text-neutral-500">({netBags.toLocaleString()} net)</span>
                      </span>
                      <span className="text-neutral-400">
                        {(p.currentKilos ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                        kg ({avgWeight.toFixed(2)})
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
      </div>

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

function SummaryCard({ label, value, sub = false }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className={sub ? 'mt-1 text-lg font-medium text-neutral-300' : 'mt-1 text-2xl font-semibold text-white'}>
        {value}
      </p>
    </div>
  )
}

export default Home
