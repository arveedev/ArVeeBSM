// Customer directory admin panel - view, edit, and delete entries.
// Customers are normally built up automatically as forms are saved
// (see customerDirectory.js); this panel is the only place to correct
// a mistake or remove one entirely, since there was previously no way
// to do either.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { Pencil, Trash2, Search } from 'lucide-react'
import { db } from '../../../db/dexie.js'
import { normalizeCustomerName } from '../../../utils/customerDirectory.js'
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

function CustomersPanel() {
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [name, setName] = useState('')
  const [rsbsa, setRsbsa] = useState('')
  const [gender, setGender] = useState('')
  const [address, setAddress] = useState('')
  const [nicknames, setNicknames] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)

  const customers = useLiveQuery(() => db.customers.toArray(), [])
  const allAliases = useLiveQuery(() => db.customerAliases.toArray(), []) ?? []

  const nicknamesByCustomer = new Map()
  for (const a of allAliases) {
    if (!nicknamesByCustomer.has(a.customerId)) nicknamesByCustomer.set(a.customerId, [])
    nicknamesByCustomer.get(a.customerId).push(a.displayLabel)
  }

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setRsbsa('')
    setGender('')
    setAddress('')
    setNicknames('')
  }

  const handleEdit = (customer) => {
    setEditingId(customer.customerId)
    setName(customer.name)
    setRsbsa(customer.rsbsa ?? '')
    setGender(customer.gender ?? '')
    setAddress(customer.address ?? '')
    setNicknames((nicknamesByCustomer.get(customer.customerId) ?? []).join(', '))
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Customer name is required')
      return
    }
    if (!editingId) return

    const normalizedName = normalizeCustomerName(name)
    // A rename could collide with a different, already-existing
    // customer - check before saving rather than silently merging two
    // unrelated records together.
    const collision = await db.customers
      .where('normalizedName').equals(normalizedName)
      .and((c) => c.customerId !== editingId)
      .first()
    if (collision) {
      toast.error(`Another customer named "${collision.name}" already exists`)
      return
    }

    // Nicknames must be globally unique - the same short name can't map
    // to two different customers, or the AI/SIA sync would have no way
    // to know which one a sheet row actually means. Same exact rule and
    // reasoning as WarehousesPanel's own alias uniqueness check.
    const rawNicknames = nicknames.split(',').map((n) => n.trim()).filter(Boolean)
    const seenNormalized = new Map()
    for (const raw of rawNicknames) {
      seenNormalized.set(normalizeCustomerName(raw), raw)
    }
    const cleanedNicknames = [...seenNormalized.entries()].map(([normalized, displayLabel]) => ({ normalized, displayLabel }))

    for (const { normalized, displayLabel } of cleanedNicknames) {
      const nicknameOwner = await db.customerAliases.get(normalized)
      if (nicknameOwner && nicknameOwner.customerId !== editingId) {
        const owner = (customers ?? []).find((c) => c.customerId === nicknameOwner.customerId)
        toast.error(`Nickname "${displayLabel}" is already used by ${owner?.name ?? 'another customer'}`)
        return
      }
    }

    await db.customers.update(editingId, {
      name: name.trim(),
      normalizedName,
      rsbsa: rsbsa.trim() || null,
      gender: gender.trim() || null,
      address: address.trim() || null,
    })

    // Replace this customer's nicknames wholesale - same simpler-and-
    // safer-than-diffing approach as WarehousesPanel.
    const existingForThisCustomer = await db.customerAliases.where('customerId').equals(editingId).toArray()
    await db.customerAliases.bulkDelete(existingForThisCustomer.map((a) => a.alias))
    if (cleanedNicknames.length > 0) {
      await db.customerAliases.bulkAdd(cleanedNicknames.map(({ normalized, displayLabel }) => ({
        alias: normalized,
        displayLabel,
        customerId: editingId,
      })))
    }

    toast.success('Customer updated')
    resetForm()
  }

  const confirmDelete = async () => {
    const customerId = pendingDelete
    setPendingDelete(null)
    await db.customers.delete(customerId)
    const orphanedAliases = await db.customerAliases.where('customerId').equals(customerId).toArray()
    await db.customerAliases.bulkDelete(orphanedAliases.map((a) => a.alias))
    if (editingId === customerId) resetForm()
    toast.success('Customer deleted')
  }

  const normalizedSearch = normalizeCustomerName(search)
  const filtered = (customers ?? [])
    .filter((c) => !normalizedSearch || c.normalizedName.includes(normalizedSearch))
    .sort((a, b) => byAlpha(a.name, b.name))

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-semibold text-app-text">Customers</h2>

      {editingId && (
        <div className="mt-4 space-y-3 rounded-xl border border-brand-neon/30 bg-brand-neon/5 p-3">
          <div>
            <label className={labelClass}>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>RSBSA (optional)</label>
            <input type="text" value={rsbsa} onChange={(e) => setRsbsa(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Gender (optional)</label>
            <input type="text" value={gender} onChange={(e) => setGender(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Address (optional)</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Nicknames (optional, comma-separated)</label>
            <input
              type="text"
              value={nicknames}
              onChange={(e) => setNicknames(e.target.value)}
              className={inputClass}
              placeholder="Dens RM"
            />
            <p className="mt-1 text-xs text-neutral-500">
              A short name used on the AI/SIA sheet that isn't this customer's real name - e.g. "Dens RM"
              for "{name.trim() || 'Dens Marketing Corp'}". Synced AI/SIA data, input forms, reports, and
              exports will all show the real name above instead.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSave} className={`flex-1 ${primaryButtonClass}`}>
              Save
            </button>
            <button type="button" onClick={resetForm} className={secondaryButtonClass}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="relative mt-4">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers…"
          className={`${inputClass} pl-9`}
        />
      </div>

      <ul className="mt-3 space-y-2">
        {filtered.length === 0 && (
          <p className="py-4 text-center text-xs text-neutral-500">
            {normalizedSearch ? 'No matching customers' : 'No customers yet'}
          </p>
        )}
        {filtered.map((c) => (
          <li key={c.customerId} className={listItemClass}>
            <div>
              <p className="font-medium text-app-text">{c.name}</p>
              {c.address && <p className="text-xs text-neutral-500">{c.address}</p>}
              {(nicknamesByCustomer.get(c.customerId)?.length ?? 0) > 0 && (
                <p className="text-xs text-brand-neon">
                  aka {nicknamesByCustomer.get(c.customerId).join(', ')}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => handleEdit(c)} aria-label="Edit" className={editIconClass}>
                <Pencil size={20} />
              </button>
              <button type="button" onClick={() => setPendingDelete(c.customerId)} aria-label="Delete" className={deleteIconClass}>
                <Trash2 size={20} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this customer?"
        description="This removes them from the directory entirely - their past transactions are unaffected, but autocomplete/auto-fill will no longer recognize this name."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}

export default CustomersPanel
