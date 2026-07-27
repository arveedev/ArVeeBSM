// Authority Picker Modal — shown when the user taps the AI/SIA field
// inside a WSI or ESI form. Lists pending (not yet complete) AI/SIA for
// the current warehouse with enough detail to identify the right one at
// a glance, so the user picks from a list instead of typing a number by
// hand (which risks typos entering the wrong AI/SIA entirely). Selecting
// one hands the full authority record back to the caller - StockFormBase
// and SackFormBase have different field shapes, so each decides for
// itself how to apply it, this modal only handles picking.

import { useLiveQuery } from 'dexie-react-hooks'
import { X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { isAuthorityComplete, authorityExtraDetails, fmtBags, fmtWeight } from '../../utils/calculations.js'
import { useSettings } from '../../context/SettingsContext.jsx'

function AuthorityPickerModal({ type, warehouseId, filterVarietyId, onSelect, onClose }) {
  const { weightUnit } = useSettings() ?? {}

  const authorities = useLiveQuery(async () => {
    if (!warehouseId) return []
    return db.authorities
      .where('assignedWarehouse').equals(warehouseId)
      .and((a) => a.type === type)
      .toArray()
  }, [warehouseId, type]) ?? []

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))
  const filterVariety = filterVarietyId ? varietyMap.get(filterVarietyId) : null

  // Palay is green, Rice is blue - matches the same convention used
  // elsewhere in the AI/SIA monitor.
  const categoryColor = (a) => {
    const category = type === 'AI' ? varietyMap.get(a.varietyId)?.category : sackTypeMap.get(a.sackLines?.[0]?.sackTypeId)?.category
    if (category === 'Rice') return 'text-blue-400'
    if (category === 'Palay') return 'text-brand-neon'
    return 'text-app-text'
  }

  const pending = authorities
    .filter((a) => !isAuthorityComplete(a))
    // Only AI has a variety of its own - when a pile/variety is already
    // selected in the form, only show authorities for that SAME variety,
    // so the user can never accidentally issue against an AI meant for a
    // different variety than the pile they're actually working with.
    .filter((a) => (type === 'AI' && filterVarietyId ? a.varietyId === filterVarietyId : true))
    .sort((a, b) => {
      const aRef = type === 'AI' ? a.aiNumber : a.siaNumber
      const bRef = type === 'AI' ? b.aiNumber : b.siaNumber
      return (aRef ?? '').localeCompare(bRef ?? '')
    })

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-neutral-800 bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-app-text">Select Pending {type}</h2>
            {filterVariety && (
              <p className="mt-0.5 text-xs text-brand-neon">
                Showing only {filterVariety.name} ({filterVariety.category}) authorities
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-950 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-3 flex-1 overflow-y-auto">
          {pending.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-500">
              No pending {type} records for this warehouse{filterVariety ? ` and ${filterVariety.name}` : ''}.
            </p>
          ) : (
            <ul className="space-y-2">
              {pending.map((a) => {
                const variety = type === 'AI' ? varietyMap.get(a.varietyId) : null
                const isSia = type === 'SIA'
                const totalAllocBags = isSia
                  ? (a.sackLines ?? []).reduce((s, l) => s + (l.totalAllocationBags ?? 0), 0)
                  : a.totalAllocationBags
                const totalIssuedBags = isSia
                  ? (a.sackLines ?? []).reduce((s, l) => s + (l.totalIssuedBags ?? 0), 0)
                  : a.totalIssuedBags
                const unitLabel = isSia ? 'pieces' : 'bags'
                return (
                  <li key={a.authId}>
                    <button
                      type="button"
                      onClick={() => onSelect(a)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-left transition-all hover:border-brand-neon/50 active:scale-[0.99]"
                    >
                      <div className="min-w-0">
                        <p className={`truncate text-sm font-medium ${categoryColor(a)}`}>
                          {type} · {type === 'AI' ? a.aiNumber : a.siaNumber}
                        </p>
                        <p className="break-words text-xs text-neutral-400">{a.customerName}</p>
                        <p className="break-words text-xs text-neutral-500">
                          {type === 'AI' && variety ? `${variety.name} (${variety.category})` : ''}
                          {isSia && (a.sackLines ?? []).length > 0
                            ? a.sackLines.map((l) => `${sackTypeMap.get(l.sackTypeId)?.code ?? '?'} ${l.condition ?? ''}`).join(', ')
                            : ''}
                        </p>
                        {authorityExtraDetails(a).length > 0 && (
                          <p className="break-words text-xs text-neutral-600">
                            {authorityExtraDetails(a).map((d) => `${d.label}: ${d.value}`).join(' · ')}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {a.totalAllocationKilos != null && (
                          <p className="text-xs font-semibold text-app-text">
                            {fmtWeight(a.totalIssuedKilos ?? 0, weightUnit)}
                            <span className="text-neutral-500"> / {fmtWeight(a.totalAllocationKilos, weightUnit)}</span>
                          </p>
                        )}
                        {totalAllocBags != null && (
                          <p className="text-xs font-semibold text-app-text">
                            {fmtBags(totalIssuedBags ?? 0)}
                            <span className="text-neutral-500"> / {fmtBags(totalAllocBags)} {unitLabel}</span>
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export default AuthorityPickerModal
