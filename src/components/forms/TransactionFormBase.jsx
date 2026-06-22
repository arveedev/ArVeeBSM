// Shared transaction form — implements Steps 5.1-5.3, replicated across
// WSR/WSI/WTS/ESI/ESR (Step 5.4) via thin per-type wrappers.
//
// - Step 5.1: Gross Kilos, MTS, Pile ID inputs. If `includeFarmerCoop` is
//   set (WSR only), a "c/o Farmer Organization" toggle reveals Member Full
//   Name, RSBSA Reference Registration ID, and Gender.
// - Step 5.2: serial number is generated on mount via the collision-free
//   compound key strategy (Section 3.1 / serialNumber.js).
// - Step 5.3: Net Kilos / Net Bags (Section 4.1) update live as Gross Kilos
//   / MTS change.
//
// Action labels use the strict uniform strings from Section 2.3: Save,
// Cancel.

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/AuthContext.jsx'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { db } from '../../db/dexie.js'
import { calculateNetKilos, calculateNetBags } from '../../utils/calculations.js'
import { generateSerialNumber, getInitials } from '../../utils/serialNumber.js'

const GENDERS = ['Male', 'Female']

const inputClass =
  'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-brand-neon'

const labelClass = 'text-xs text-neutral-400'

const readOnlyClass =
  'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-white'

function TransactionFormBase({ type, title, includeFarmerCoop = false, onClose }) {
  const { user } = useAuth()
  const { currentWarehouse } = useWarehouse() ?? {}

  const [serialNo, setSerialNo] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [pileId, setPileId] = useState('')
  const [grossKilos, setGrossKilos] = useState('')
  const [mts, setMts] = useState('')
  const [millingRecovery, setMillingRecovery] = useState('')

  const [farmerCoopEnabled, setFarmerCoopEnabled] = useState(false)
  const [farmerName, setFarmerName] = useState('')
  const [farmerRsbsa, setFarmerRsbsa] = useState('')
  const [farmerGender, setFarmerGender] = useState('Male')

  const [isSaving, setIsSaving] = useState(false)

  const piles = useLiveQuery(async () => {
    if (!currentWarehouse) return []
    return db.piles.where('warehouseId').equals(currentWarehouse.warehouseId).toArray()
  }, [currentWarehouse?.warehouseId])

  // Step 5.2 — generate the next collision-free serial number on load.
  useEffect(() => {
    if (!currentWarehouse || !user) return

    let cancelled = false

    generateSerialNumber({
      warehouseCode: currentWarehouse.code,
      type,
      initials: getInitials(user.name),
    }).then((serial) => {
      if (!cancelled) setSerialNo(serial)
    })

    return () => {
      cancelled = true
    }
  }, [currentWarehouse?.code, type, user?.name])

  // Step 5.3 — real-time Net Kilos / Net Bags (Section 4.1).
  const grossNum = Number(grossKilos) || 0
  const mtsNum = Number(mts) || 0
  const netKilos = calculateNetKilos(grossNum, mtsNum)
  const netBags = calculateNetBags(netKilos)

  const handleSave = async () => {
    if (!currentWarehouse) {
      toast.error('No warehouse selected')
      return
    }

    if (!pileId) {
      toast.error('Select a Pile ID')
      return
    }

    if (!grossKilos || grossNum <= 0) {
      toast.error('Gross Kilos must be greater than 0')
      return
    }

    if (mts === '' || mtsNum < 0) {
      toast.error('MTS must be 0 or greater')
      return
    }

    if (includeFarmerCoop && farmerCoopEnabled) {
      if (!farmerName.trim() || !farmerRsbsa.trim()) {
        toast.error('Member Full Name and RSBSA are required')
        return
      }
    }

    setIsSaving(true)

    const transaction = {
      id: crypto.randomUUID(),
      type,
      serialNo,
      status: 'Active',
      date,
      pileId,
      grossKilos: grossNum,
      mts: mtsNum,
      netKilos,
      netBags,
      millingRecovery: millingRecovery === '' ? 0 : Number(millingRecovery),
      farmerCoop:
        includeFarmerCoop && farmerCoopEnabled
          ? { name: farmerName.trim(), rsbsa: farmerRsbsa.trim(), gender: farmerGender }
          : null,
      isSynced: false,
    }

    await db.transactions.add(transaction)

    toast.success(`${type} saved — ${serialNo}`)
    setIsSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      <div className="flex-1 overflow-y-auto px-4 pb-28 pt-6">
        <h1 className="text-xl font-semibold text-white">{title}</h1>

        <div className="mt-1 flex items-center justify-between">
          <p className="text-xs text-neutral-400">Serial No.</p>
          <p className="font-mono text-xs text-brand-neon">{serialNo || '—'}</p>
        </div>

        {currentWarehouse && (
          <p className="mt-1 text-xs text-neutral-500">
            {currentWarehouse.code} — {currentWarehouse.name}
          </p>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <label className={labelClass}>Date</label>
            {/* type="date" triggers the device-native date picker (Section 2.3) */}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Pile ID</label>
            <select
              value={pileId}
              onChange={(e) => setPileId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select pile…</option>
              {(piles ?? []).map((p) => (
                <option key={p.pileId} value={p.pileId}>
                  {p.pileName} ({p.cerealType})
                </option>
              ))}
            </select>
            {(piles ?? []).length === 0 && (
              <p className="mt-1 text-xs text-neutral-500">
                No piles found for this warehouse yet.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Gross Kilos</label>
              {/* type="number" launches the software number pad (Section 2.3) */}
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={grossKilos}
                onChange={(e) => setGrossKilos(e.target.value)}
                className={inputClass}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className={labelClass}>MTS</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={mts}
                onChange={(e) => setMts(e.target.value)}
                className={inputClass}
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Step 5.3 — real-time, read-only */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Net Kilos</label>
              <div className={readOnlyClass}>{netKilos.toFixed(2)}</div>
            </div>
            <div>
              <label className={labelClass}>Net Bags</label>
              <div className={readOnlyClass}>{netBags.toFixed(2)}</div>
            </div>
          </div>

          <div>
            <label className={labelClass}>Milling Recovery (%)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={millingRecovery}
              onChange={(e) => setMillingRecovery(e.target.value)}
              className={inputClass}
              placeholder="0.00"
            />
          </div>

          {includeFarmerCoop && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
              <label className="flex items-center gap-2 text-sm text-white">
                <input
                  type="checkbox"
                  checked={farmerCoopEnabled}
                  onChange={(e) => setFarmerCoopEnabled(e.target.checked)}
                  className="accent-brand-neon"
                />
                c/o Farmer Organization
              </label>

              {farmerCoopEnabled && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className={labelClass}>Member Full Name</label>
                    <input
                      type="text"
                      value={farmerName}
                      onChange={(e) => setFarmerName(e.target.value)}
                      className={inputClass}
                      placeholder="Juan Dela Cruz"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>RSBSA Reference Registration ID</label>
                    <input
                      type="text"
                      value={farmerRsbsa}
                      onChange={(e) => setFarmerRsbsa(e.target.value)}
                      className={inputClass}
                      placeholder="01-23-45-678-901234"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Gender</label>
                    <select
                      value={farmerGender}
                      onChange={(e) => setFarmerGender(e.target.value)}
                      className={inputClass}
                    >
                      {GENDERS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sticky Save/Cancel footer */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-800 bg-neutral-900 p-4 pb-6">
        <div className="mx-auto flex max-w-md gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-3 text-sm font-medium text-neutral-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export default TransactionFormBase
