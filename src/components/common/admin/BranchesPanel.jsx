// Branches — a branch groups one or more provinces under a shared name
// and address that appear in the NFA report header:
//
//   NATIONAL FOOD AUTHORITY
//   ALBAY BRANCH              <- branch.name
//   PIER SITE, LEGAZPI CITY   <- branch.address
//
// The chain is: Branch → Province → Warehouse. Assign provinces to a
// branch here; warehouses automatically inherit the branch through their
// province. This way you never need to manually assign each warehouse —
// just assign the province once, and every warehouse in that province
// gets the right branch header on its reports.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, Trash2 } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import ConfirmDialog from '../ConfirmDialog.jsx'
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  listItemClass,
  editIconClass,
  deleteIconClass,
  byAlpha,
} from './shared.js'

function BranchesPanel() {
  const [name, setName] = useState('')
  const [region, setRegion] = useState('')
  const [address, setAddress] = useState('')
  const [selectedProvinceIds, setSelectedProvinceIds] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const branches = useLiveQuery(() => db.branches.toArray(), [])
  const provinces = useLiveQuery(() => db.provinces.toArray(), [])

  const sortedBranches = [...(branches ?? [])].sort((a, b) => byAlpha(a.name, b.name))
  const sortedProvinces = [...(provinces ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  const resetForm = () => {
    setName('')
    setRegion('')
    setAddress('')
    setSelectedProvinceIds([])
    setEditingId(null)
  }

  const toggleProvince = (provinceId) => {
    setSelectedProvinceIds((prev) =>
      prev.includes(provinceId)
        ? prev.filter((id) => id !== provinceId)
        : [...prev, provinceId]
    )
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Branch name is required')
      return
    }

    const existing = await db.branches.where('name').equals(name.trim()).first()
    if (existing && existing.branchId !== editingId) {
      toast.error('A branch with that name already exists')
      return
    }

    const branchId = editingId ?? crypto.randomUUID()

    if (editingId) {
      await db.branches.update(editingId, {
        name: name.trim(),
        region: region.trim() || null,
        address: address.trim() || null,
      })
    } else {
      await db.branches.add({
        branchId,
        name: name.trim(),
        region: region.trim() || null,
        address: address.trim() || null,
      })
    }

    // Update province assignments: clear any provinces previously assigned
    // to this branch that are no longer selected, then assign the selected ones.
    const allProvinces = await db.provinces.toArray()
    for (const p of allProvinces) {
      if (p.branchId === branchId && !selectedProvinceIds.includes(p.provinceId)) {
        await db.provinces.update(p.provinceId, { branchId: null })
      }
    }
    for (const id of selectedProvinceIds) {
      await db.provinces.update(id, { branchId })
    }

    toast.success(editingId ? 'Branch updated' : 'Branch saved')
    resetForm()
  }

  const handleEdit = (branch) => {
    setEditingId(branch.branchId)
    setName(branch.name)
    setRegion(branch.region ?? '')
    setAddress(branch.address ?? '')
    const assigned = (provinces ?? [])
      .filter((p) => p.branchId === branch.branchId)
      .map((p) => p.provinceId)
    setSelectedProvinceIds(assigned)
  }

  const handleDeleteConfirmed = async () => {
    if (!pendingDelete) return
    // Unlink provinces from this branch
    const linked = await db.provinces.where('branchId').equals(pendingDelete.branchId).toArray()
    for (const p of linked) {
      await db.provinces.update(p.provinceId, { branchId: null })
    }
    await db.branches.delete(pendingDelete.branchId)
    toast.success('Branch deleted')
    setPendingDelete(null)
    if (editingId === pendingDelete.branchId) resetForm()
  }

  // Build display info: which provinces each branch currently covers
  const provincesByBranch = {}
  for (const p of provinces ?? []) {
    if (p.branchId) {
      if (!provincesByBranch[p.branchId]) provincesByBranch[p.branchId] = []
      provincesByBranch[p.branchId].push(p)
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Branches</h2>
      <p className="mt-1 text-xs text-neutral-400">
        A branch covers one or more provinces. Every warehouse in those
        provinces inherits this branch's header on NFA reports.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className={labelClass}>Branch Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="ALBAY BRANCH"
          />
        </div>
        <div>
          <label className={labelClass}>Region</label>
          <input
            type="text"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className={inputClass}
            placeholder="V"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Region code shown in the NFA report header (e.g. V, VII, X).
          </p>
        </div>
        <div>
          <label className={labelClass}>Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={inputClass}
            placeholder="PIER SITE, LEGAZPI CITY"
          />
        </div>

        <div>
          <label className={labelClass}>Provinces in this Branch</label>
          <div className="mt-1 space-y-1">
            {sortedProvinces.length === 0 && (
              <p className="text-xs text-neutral-500">
                No provinces configured yet — add them in the Provinces tab first.
              </p>
            )}
            {sortedProvinces.map((p) => {
              const checked = selectedProvinceIds.includes(p.provinceId)
              return (
                <button
                  key={p.provinceId}
                  type="button"
                  onClick={() => toggleProvince(p.provinceId)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-all ${
                    checked
                      ? 'border-brand-neon bg-brand-neon/10 text-brand-neon'
                      : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-600'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                      checked ? 'border-brand-neon text-brand-neon' : 'border-neutral-600'
                    }`}
                  >
                    {checked ? '✓' : ''}
                  </span>
                  {p.code} — {p.name}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={handleSave} className={`flex-1 ${primaryButtonClass}`}>
            {editingId ? 'Update' : 'Save'}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className={`flex-1 ${secondaryButtonClass}`}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {sortedBranches.map((branch) => {
          const coveredProvinces = provincesByBranch[branch.branchId] ?? []
          return (
            <li key={branch.branchId} className={listItemClass}>
              <div className="min-w-0">
                <p className="font-medium text-app-text">{branch.name}</p>
                {branch.address && (
                  <p className="text-xs text-neutral-400">{branch.address}</p>
                )}
                {coveredProvinces.length > 0 && (
                  <p className="text-xs text-neutral-500">
                    {coveredProvinces.map((p) => p.code).join(', ')}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => handleEdit(branch)} aria-label="Edit" className={editIconClass}>
                  <Pencil size={15} />
                </button>
                <button type="button" onClick={() => setPendingDelete(branch)} aria-label="Delete" className={deleteIconClass}>
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete "${pendingDelete?.name}"?`}
        description="Provinces assigned to this branch will be unlinked. Warehouses will lose this branch header on reports."
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

export default BranchesPanel
