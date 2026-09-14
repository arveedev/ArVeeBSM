// Disbursement settings — Admin only.
//
// Two unrelated but both-small settings grouped on one tab: how Purity
// is displayed/printed everywhere it appears, and which specific SDOs
// currently have the Pricer incentive turned on.
//
// Pricer is deliberately NOT a branch-wide switch - confirmed directly
// ("it is not always active... it is actually per SDO" - eligibility
// depends on situational factors an Admin decides case by case). Off is
// the normal, default state for every SDO.

import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { db } from '../../../db/dexie.js'
import { byAlpha, inputClass, labelClass, primaryButtonClass } from './shared.js'

// Prepared By is NOT configured here - it's always the SDO who actually
// generated the export, filled in dynamically at export time
// (AbstractExportModal.jsx), never an admin-set fixed name. Only
// Verified By and Noted By are genuinely fixed branch roles (the
// Accountant and Branch Manager who sign off regardless of which SDO
// prepared it).
const SIG_FIELDS = [
  { key: 'disbursementVerifiedBy', label: 'Verified By' },
  { key: 'disbursementNotedBy', label: 'Noted By' },
]

function DisbursementSettingsPanel() {
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const purityDisplayFormat = config?.purityDisplayFormat ?? 'range'

  const [sigForm, setSigForm] = useState({})
  useEffect(() => {
    if (!config) return
    setSigForm(Object.fromEntries(SIG_FIELDS.map(({ key }) => [key, config[key] ?? { name: '', position: '' }])))
  }, [config?.id])

  const updateSig = (key, field, value) =>
    setSigForm((f) => ({ ...f, [key]: { ...f[key], [field]: value } }))

  const saveSignatories = async () => {
    await db.reportConfig.put({ ...(config ?? { id: 'global' }), ...sigForm })
    toast.success('Abstract signatories saved')
  }

  const sdoUsers = useLiveQuery(() => db.users.where('role').equals('SDO').toArray(), []) ?? []
  const sortedSdos = [...sdoUsers].sort((a, b) => byAlpha(a.nickname, b.nickname))
  const eligibility = useLiveQuery(() => db.pricerEligibility.toArray(), []) ?? []
  const eligibilityByUid = new Map(eligibility.map((e) => [e.uid, e.enabled]))

  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const describeWarehouses = (uids) =>
    (uids ?? []).map((id) => warehouseMap.get(id)?.name).filter(Boolean).join(', ') || 'None assigned'

  const setPurityFormat = async (format) => {
    await db.reportConfig.put({ ...(config ?? { id: 'global' }), purityDisplayFormat: format })
  }

  const togglePricer = async (uid, enabled) => {
    await db.pricerEligibility.put({ uid, enabled, updatedAt: new Date().toISOString() })
    toast.success(enabled ? 'Pricer enabled for this SDO' : 'Pricer disabled for this SDO')
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Disbursement Settings</h2>

      <div className="mt-4 flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5">
        <div>
          <p className="text-sm font-medium text-app-text">Purity display format</p>
          <p className="text-xs text-neutral-500">Applies to the Purchase Receipt reference screen and the Abstract export.</p>
        </div>
        <div className="flex rounded-lg border border-neutral-800 overflow-hidden">
          <button
            type="button"
            onClick={() => setPurityFormat('range')}
            className={`px-3 py-1.5 text-xs font-semibold ${purityDisplayFormat === 'range' ? 'bg-brand-neon text-brand-contrast' : 'text-neutral-400'}`}
          >
            Range
          </button>
          <button
            type="button"
            onClick={() => setPurityFormat('letter')}
            className={`px-3 py-1.5 text-xs font-semibold ${purityDisplayFormat === 'letter' ? 'bg-brand-neon text-brand-contrast' : 'text-neutral-400'}`}
          >
            Letter
          </button>
        </div>
      </div>

      <p className="mt-5 text-xs font-semibold uppercase text-neutral-500">Abstract Signatories</p>
      <div className="mt-2 space-y-2">
        {SIG_FIELDS.map(({ key, label }) => (
          <div key={key} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
            <p className="text-xs font-semibold text-app-text">{label}</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <input
                type="text"
                value={sigForm[key]?.name ?? ''}
                onChange={(e) => updateSig(key, 'name', e.target.value)}
                className={inputClass}
                placeholder="Full name"
              />
              <input
                type="text"
                value={sigForm[key]?.position ?? ''}
                onChange={(e) => updateSig(key, 'position', e.target.value)}
                className={inputClass}
                placeholder="Position"
              />
            </div>
          </div>
        ))}
        <button type="button" onClick={saveSignatories} className={primaryButtonClass}>
          Save Signatories
        </button>
      </div>

      <p className="mt-5 text-xs font-semibold uppercase text-neutral-500">Pricer Incentive Eligibility</p>
      {sortedSdos.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500">No SDO users configured yet — add one under Structure → Users.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {sortedSdos.map((u) => {
            const enabled = eligibilityByUid.get(u.uid) ?? false
            return (
              <li key={u.uid} className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-app-text">{u.name}</p>
                  <p className="text-xs text-neutral-500">{describeWarehouses(u.assignedWarehouses)}</p>
                </div>
                <div className="flex rounded-lg border border-neutral-800 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => togglePricer(u.uid, false)}
                    className={`px-3 py-1.5 text-xs font-semibold ${!enabled ? 'bg-brand-neon text-brand-contrast' : 'text-neutral-400'}`}
                  >
                    Off
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePricer(u.uid, true)}
                    className={`px-3 py-1.5 text-xs font-semibold ${enabled ? 'bg-brand-neon text-brand-contrast' : 'text-neutral-400'}`}
                  >
                    On
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default DisbursementSettingsPanel
