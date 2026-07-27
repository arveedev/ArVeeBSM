// Users — roles are Title Case: 'Admin' | 'Warehouse Supervisor' |
// 'Warehouse Assistant'. `name` is the full legal name (for reports/
// signatures); `nickname` is shown on the welcome toast and the warehouse
// Home page. `assignedWarehouses` is an array of warehouseId — a user can
// be assigned to multiple warehouses. Admins implicitly have access to
// every warehouse regardless of this list.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, Trash2 } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { hashPin } from '../../../utils/pinHash.js'
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
  ROLES,
} from './shared.js'

const emptyForm = {
  accessCode: '',
  role: 'Warehouse Assistant',
  name: '',
  nickname: '',
  assignedWarehouses: [],
}

function UsersPanel() {
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const users = useLiveQuery(() => db.users.toArray(), [])
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), [])
  const provinces = useLiveQuery(() => db.provinces.toArray(), [])

  const warehouseMap = new Map((warehouses ?? []).map((w) => [w.warehouseId, w]))
  const provinceMap = new Map((provinces ?? []).map((p) => [p.provinceId, p]))
  const sortedUsers = [...(users ?? [])].sort((a, b) => byAlpha(a.nickname, b.nickname))

  const isAdmin = form.role === 'Admin'

  const updateField = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  const toggleWarehouse = (warehouseId) => {
    setForm((f) => {
      const set = new Set(f.assignedWarehouses)
      if (set.has(warehouseId)) set.delete(warehouseId)
      else set.add(warehouseId)
      return { ...f, assignedWarehouses: [...set] }
    })
  }

  const resetForm = () => {
    setForm(emptyForm)
    setEditingId(null)
  }

  const handleSave = async () => {
    const isNewUser = !editingId
    if (isNewUser && form.accessCode.length !== 6) {
      toast.error('Access PIN must be exactly 6 digits')
      return
    }
    if (form.accessCode && form.accessCode.length !== 6) {
      toast.error('Access PIN must be exactly 6 digits')
      return
    }
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!form.nickname.trim()) {
      toast.error('Nickname is required')
      return
    }
    if (!isAdmin && form.assignedWarehouses.length === 0) {
      toast.error('Assign at least one warehouse')
      return
    }

    // PINs are never stored or compared in plain text - hash before any
    // uniqueness check or save. A blank PIN field while editing means
    // "keep the current PIN unchanged", not "clear it".
    let hashedAccessCode
    if (form.accessCode) {
      hashedAccessCode = await hashPin(form.accessCode)
      const existing = await db.users.where('accessCode').equals(hashedAccessCode).first()
      if (existing && existing.uid !== editingId) {
        toast.error('That access PIN is already registered')
        return
      }
    }

    const record = {
      role: form.role,
      name: form.name.trim(),
      nickname: form.nickname.trim(),
      // Admins have implicit access to every warehouse — store an empty
      // list rather than every warehouseId so it stays correct as new
      // warehouses are added.
      assignedWarehouses: isAdmin ? [] : form.assignedWarehouses,
    }
    if (hashedAccessCode) record.accessCode = hashedAccessCode

    if (editingId) {
      await db.users.update(editingId, record)
      toast.success('User updated')
    } else {
      await db.users.add({ uid: crypto.randomUUID(), ...record })
      toast.success('User saved')
    }

    resetForm()
  }

  const handleEdit = (user) => {
    setEditingId(user.uid)
    setForm({
      accessCode: '', // never pre-filled - the stored value is a hash, not the real PIN, and leaving this blank means "keep current" on save
      role: user.role,
      name: user.name ?? '',
      nickname: user.nickname ?? '',
      assignedWarehouses: user.assignedWarehouses ?? [],
    })
  }

  const confirmDelete = async () => {
    const uid = pendingDelete
    setPendingDelete(null)
    await db.users.delete(uid)
    if (editingId === uid) resetForm()
    toast.success('User deleted')
  }

  // Group warehouses by province for the multi-select checklist, sorted
  // alphabetically.
  const grouped = [...(provinces ?? [])]
    .sort((a, b) => byAlpha(a.code, b.code))
    .map((p) => ({
      province: p,
      items: (warehouses ?? [])
        .filter((w) => w.provinceId === p.provinceId)
        .sort((a, b) => byAlpha(a.name, b.name)),
    }))

  const describeAccess = (user) => {
    if (user.role === 'Admin') return 'All Warehouses'
    const names = (user.assignedWarehouses ?? [])
      .map((id) => warehouseMap.get(id)?.name)
      .filter(Boolean)
    return names.length > 0 ? names.join(', ') : 'No warehouse assigned'
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Users</h2>

      <div className="mt-4 space-y-3">
        <div>
          <label className={labelClass}>
            Access PIN (6 digits){editingId ? ' — leave blank to keep current PIN' : ''}
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={form.accessCode}
            onChange={(e) =>
              updateField('accessCode', e.target.value.replace(/[^0-9]/g, '').slice(0, 6))
            }
            className={inputClass}
            placeholder={editingId ? 'Leave blank to keep current PIN' : '••••••'}
          />
        </div>

        <div>
          <label className={labelClass}>Role</label>
          <select
            value={form.role}
            onChange={(e) => updateField('role', e.target.value)}
            className={inputClass}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Full Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            className={inputClass}
            placeholder="Juan Dela Cruz"
          />
        </div>

        <div>
          <label className={labelClass}>Nickname</label>
          <input
            type="text"
            value={form.nickname}
            onChange={(e) => updateField('nickname', e.target.value)}
            className={inputClass}
            placeholder="Juan"
          />
        </div>

        {isAdmin ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-400">
            Admins have access to every warehouse by default.
          </div>
        ) : (
          <div>
            <label className={labelClass}>Assigned Warehouses</label>
            <div className="mt-1 max-h-48 space-y-3 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-3">
              {grouped.length === 0 && (
                <p className="text-xs text-neutral-500">No warehouses configured yet.</p>
              )}
              {grouped.map(
                (group) =>
                  group.items.length > 0 && (
                    <div key={group.province.provinceId}>
                      <p className="text-xs font-semibold uppercase text-neutral-500">
                        {group.province.code}
                      </p>
                      <div className="mt-1 space-y-1">
                        {group.items.map((w) => (
                          <label
                            key={w.warehouseId}
                            className="flex items-center gap-2 text-sm text-app-text"
                          >
                            <input
                              type="checkbox"
                              checked={form.assignedWarehouses.includes(w.warehouseId)}
                              onChange={() => toggleWarehouse(w.warehouseId)}
                              className="accent-brand-neon"
                            />
                            {w.code} — {w.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={handleSave} className={`flex-1 ${primaryButtonClass}`}>
            Save
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className={secondaryButtonClass}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {sortedUsers.length > 0 && (
        <ul className="mt-4 space-y-2">
          {sortedUsers.map((u) => (
            <li key={u.uid} className={listItemClass}>
              <div>
                <p className="font-medium text-app-text">
                  {u.nickname} · {u.role}
                </p>
                <p className="text-xs text-neutral-400">
                  {u.name} — {describeAccess(u)}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => handleEdit(u)}
                  aria-label="Edit"
                  className={editIconClass}
                >
                  <Pencil size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(u.uid)}
                  aria-label="Delete"
                  className={deleteIconClass}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this user?"
        description="This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

export default UsersPanel
