// Signatories — report sign-off configuration.
//
// CERTIFIED CORRECT — grouped by Warehouse Supervisor (not by warehouse).
// A supervisor assigned to multiple warehouses only needs their position
// configured once, and it applies to every warehouse they're assigned to.
// The admin sees a list of Warehouse Supervisors sorted alphabetically,
// with their assigned warehouse names shown beneath their name. Editing
// position on a supervisor row saves it to db.signatories keyed by the
// supervisor's uid.
//
// GLOBAL BLOCK — Verified Correct (one or more), Audited By, Noted By:
// the same on every report regardless of warehouse, saved to reportConfig.

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Plus, X, ChevronDown, ChevronUp } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { inputClass, labelClass, primaryButtonClass, byAlpha } from './shared.js'

const emptySignatory = () => ({ name: '', position: '' })

function SignatoriesPanel() {
  return (
    <div className="space-y-6">
      <CertifiedCorrectSection />
      <GlobalSignatoriesSection />
    </div>
  )
}

// ─── Certified Correct ────────────────────────────────────────────────────────

function CertifiedCorrectSection() {
  const users = useLiveQuery(() => db.users.toArray(), [])
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), [])

  const warehouseMap = new Map((warehouses ?? []).map((w) => [w.warehouseId, w]))

  const supervisors = [...(users ?? [])]
    .filter((u) => u.role === 'Warehouse Supervisor')
    .sort((a, b) => byAlpha(a.name, b.name))

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-white">Certified Correct</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Configure each Warehouse Supervisor's reporting position once — it
        applies to every warehouse they're assigned to. The name on the
        report is derived from the supervisor record automatically.
      </p>

      {supervisors.length === 0 && (
        <p className="mt-4 text-xs text-neutral-500">
          No Warehouse Supervisors found. Add users with the "Warehouse
          Supervisor" role in the Users tab.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {supervisors.map((supervisor) => (
          <SupervisorSignatoryRow
            key={supervisor.uid}
            supervisor={supervisor}
            warehouseMap={warehouseMap}
          />
        ))}
      </div>
    </section>
  )
}

function SupervisorSignatoryRow({ supervisor, warehouseMap }) {
  const [position, setPosition] = useState('')
  const [expanded, setExpanded] = useState(false)

  const saved = useLiveQuery(
    () => db.signatories.get(supervisor.uid),
    [supervisor.uid]
  )

  useEffect(() => {
    setPosition(saved?.certifiedCorrectPosition ?? '')
  }, [saved])

  const handleSave = async () => {
    await db.signatories.put({
      warehouseId: supervisor.uid,   // keyed by supervisor uid, not warehouseId
      certifiedCorrectPosition: position.trim(),
    })
    toast.success('Position saved')
  }

  const warehouseNames = (supervisor.assignedWarehouses ?? [])
    .map((id) => warehouseMap.get(id)?.name)
    .filter(Boolean)
    .sort((a, b) => byAlpha(a, b))

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <p className="text-sm font-medium text-white">{supervisor.name}</p>
          <p className="text-xs text-neutral-400">
            {warehouseNames.length > 0
              ? warehouseNames.join(', ')
              : 'No warehouses assigned'}
          </p>
        </div>
        {expanded
          ? <ChevronUp size={16} className="text-neutral-400" />
          : <ChevronDown size={16} className="text-neutral-400" />
        }
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          <div>
            <label className={labelClass}>Position / Designation</label>
            <input
              type="text"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className={inputClass}
              placeholder="PCO/Acting WS"
            />
          </div>
          <button
            type="button"
            onClick={handleSave}
            className={`w-full ${primaryButtonClass}`}
          >
            Save
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Global Signatories (Verified Correct / Audited By / Noted By) ───────────

function GlobalSignatoriesSection() {
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])

  const [verifiedCorrect, setVerifiedCorrect] = useState([emptySignatory()])
  const [auditedByName, setAuditedByName] = useState('')
  const [auditedByPosition, setAuditedByPosition] = useState('')
  const [notedByName, setNotedByName] = useState('')
  const [notedByPosition, setNotedByPosition] = useState('')

  useEffect(() => {
    if (!config) return
    setVerifiedCorrect(config.verifiedCorrect?.length ? config.verifiedCorrect : [emptySignatory()])
    setAuditedByName(config.auditedByName ?? '')
    setAuditedByPosition(config.auditedByPosition ?? '')
    setNotedByName(config.notedByName ?? '')
    setNotedByPosition(config.notedByPosition ?? '')
  }, [config])

  const updateVerifiedRow = (index, field, value) =>
    setVerifiedCorrect((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    )

  const addVerifiedRow = () =>
    setVerifiedCorrect((rows) => [...rows, emptySignatory()])

  const removeVerifiedRow = (index) =>
    setVerifiedCorrect((rows) => rows.length > 1 ? rows.filter((_, i) => i !== index) : rows)

  const handleSave = async () => {
    const cleanedVerified = verifiedCorrect.filter(
      (row) => row.name.trim() || row.position.trim()
    )

    await db.reportConfig.put({
      id: 'global',
      verifiedCorrect: cleanedVerified,
      auditedByName: auditedByName.trim(),
      auditedByPosition: auditedByPosition.trim(),
      notedByName: notedByName.trim(),
      notedByPosition: notedByPosition.trim(),
    })
    toast.success('Signatories saved')
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-white">
        Verified Correct · Audited By · Noted By
      </h2>
      <p className="mt-1 text-xs text-neutral-400">
        These signatories appear on every report regardless of warehouse.
      </p>

      <div className="mt-4 space-y-5">
        {/* Verified Correct — one or more */}
        <div>
          <p className="text-sm font-semibold text-white">Verified Correct</p>
          <div className="mt-2 space-y-2">
            {verifiedCorrect.map((row, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateVerifiedRow(i, 'name', e.target.value)}
                  className={`${inputClass} mt-0 flex-1`}
                  placeholder="Full name"
                />
                <input
                  type="text"
                  value={row.position}
                  onChange={(e) => updateVerifiedRow(i, 'position', e.target.value)}
                  className={`${inputClass} mt-0 flex-1`}
                  placeholder="Accountant III"
                />
                <button
                  type="button"
                  onClick={() => removeVerifiedRow(i)}
                  aria-label="Remove signatory"
                  className="rounded-xl border border-neutral-800 px-2 text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white active:scale-95"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addVerifiedRow}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-neon transition-opacity hover:opacity-80"
          >
            <Plus size={14} /> Add signatory
          </button>
        </div>

        {/* Audited By */}
        <div>
          <p className="text-sm font-semibold text-white">Audited By</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Name</label>
              <input type="text" value={auditedByName} onChange={(e) => setAuditedByName(e.target.value)} className={inputClass} placeholder="Full name" />
            </div>
            <div>
              <label className={labelClass}>Position</label>
              <input type="text" value={auditedByPosition} onChange={(e) => setAuditedByPosition(e.target.value)} className={inputClass} placeholder="State Auditor III" />
            </div>
          </div>
        </div>

        {/* Noted By */}
        <div>
          <p className="text-sm font-semibold text-white">Noted By</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Name</label>
              <input type="text" value={notedByName} onChange={(e) => setNotedByName(e.target.value)} className={inputClass} placeholder="Full name" />
            </div>
            <div>
              <label className={labelClass}>Position</label>
              <input type="text" value={notedByPosition} onChange={(e) => setNotedByPosition(e.target.value)} className={inputClass} placeholder="Branch Manager / Acting Branch Manager" />
            </div>
          </div>
        </div>

        <button type="button" onClick={handleSave} className={`w-full ${primaryButtonClass}`}>
          Save
        </button>
      </div>
    </section>
  )
}

export default SignatoriesPanel
