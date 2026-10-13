// Warehouse logistics inventory (wooden pallets, platform scales, other logistical and semi-expendable
// equipment): add, edit and delete only. The inventory is stored per warehouse (db.logisticsItems, synced) and is
// printed as the last page of the Stock Report whenever the warehouse has any items - nothing is exported from here.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import toast from 'react-hot-toast'
import { ArrowLeft, Pencil, Plus, Trash2, X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useWarehouse } from '../../context/WarehouseContext.jsx'

const PALLET_CLASSES = ['SERVICEABLE', 'UNSERVICEABLE', 'FOR REPAIR']
const SUGGESTED_ITEMS = ['TARPAULIN', 'SACKOLINE', 'BAG CLOSER', 'FUMIGATING SHEETS']

// Fields per category: [key, label]
const FIELDS = {
  pallet: [['utilized', 'Utilized'], ['available', 'Available'], ['transfer', 'Transfer']],
  scale: [['serviceable', 'Serviceable'], ['forRepair', 'For repair'], ['unserviceable', 'Unserviceable']],
  other: [['brandNew', 'Brand new'], ['serviceable', 'Serviceable'], ['unserviceable', 'Unserviceable']],
}
const CATEGORY_TITLE = { pallet: 'Wooden pallets', scale: 'Platform scale', other: 'Other logistics' }

const toNum = (v) => (v === '' || v == null ? null : Number(v))

const inputClass = 'w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-sm text-app-text outline-none focus:border-brand-neon'
const labelClass = 'text-[10px] font-semibold uppercase tracking-wide text-neutral-500'

const emptyForm = (category) => ({
  category, name: category === 'pallet' ? PALLET_CLASSES[0] : category === 'scale' ? 'MECHANICAL (1,000 KG)' : '',
  serials: '', utilized: '', available: '', transfer: '', serviceable: '', forRepair: '', unserviceable: '', brandNew: '', remarks: '',
})

function LogisticsReportModal({ onClose }) {
  const { user } = useAuth()
  const { currentWarehouse, currentWarehouseId } = useWarehouse() ?? {}
  const items = useLiveQuery(() => (currentWarehouseId ? db.logisticsItems.where('warehouseId').equals(currentWarehouseId).toArray() : []), [currentWarehouseId])
  const [editing, setEditing] = useState(null)        // { id|null, form }
  const [confirmId, setConfirmId] = useState(null)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const byCategory = (c) => (items ?? []).filter((i) => i.category === c).sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.serials ?? '').localeCompare(String(b.serials ?? '')))
  const palletOrder = (n) => { const k = PALLET_CLASSES.indexOf(n); return k < 0 ? 99 : k }

  const startAdd = (category) => setEditing({ id: null, form: emptyForm(category) })
  const startEdit = (it) => setEditing({
    id: it.itemId,
    form: { ...emptyForm(it.category), ...Object.fromEntries(Object.entries(it).map(([k, v]) => [k, v == null ? '' : String(v)])), category: it.category },
  })
  const setForm = (patch) => setEditing((e) => ({ ...e, form: { ...e.form, ...patch } }))

  const save = async () => {
    const f = editing.form
    if (!String(f.name).trim()) { toast.error(f.category === 'scale' ? 'Enter the scale type' : f.category === 'other' ? 'Enter the item name' : 'Choose a classification'); return }
    const existing = editing.id ? (items ?? []).find((i) => i.itemId === editing.id) : null
    const row = {
      itemId: editing.id ?? crypto.randomUUID(),
      warehouseId: currentWarehouseId,
      category: f.category,
      name: String(f.name).trim().toUpperCase(),
      serials: f.category === 'scale' ? String(f.serials).trim() : '',
      remarks: String(f.remarks).trim(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: user?.uid ?? null,
    }
    for (const [key] of FIELDS[f.category]) row[key] = toNum(f[key])
    await db.logisticsItems.put(row)
    toast.success(editing.id ? 'Item updated' : 'Item added')
    setEditing(null)
  }

  const remove = async (id) => {
    await db.logisticsItems.delete(id)
    setConfirmId(null)
    toast.success('Item deleted')
  }

  const summary = (it) => FIELDS[it.category].filter(([k]) => it[k] != null).map(([k, label]) => `${label} ${Number(it[k]).toLocaleString('en-PH')}`).join(' · ')
  const card = 'rounded-xl border border-neutral-800 bg-neutral-900 p-3'

  const list = (
    <>
      <p className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-400">What is recorded here prints as the last page of this warehouse's Stock Report. A warehouse with nothing recorded gets no such page.</p>
      {['pallet', 'scale', 'other'].map((cat) => {
        const rows = cat === 'pallet' ? byCategory(cat).sort((a, b) => palletOrder(a.name) - palletOrder(b.name)) : byCategory(cat)
        return (
          <section key={cat}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-brand-neon">{CATEGORY_TITLE[cat]}</h3>
              <button type="button" onClick={() => startAdd(cat)} className="flex items-center gap-1 text-xs font-medium text-brand-neon"><Plus size={14} /> Add</button>
            </div>
            <div className="mt-2 space-y-2">
              {items == null ? null : rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-neutral-800 px-3 py-3 text-xs text-neutral-500">Nothing recorded yet.</p>
              ) : rows.map((it) => (
                <div key={it.itemId} className={card}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-app-text">{it.name}{it.serials ? <span className="font-normal text-neutral-400"> · {it.serials}</span> : null}</p>
                      <p className="mt-0.5 text-xs text-neutral-400">{summary(it) || 'No quantities'}</p>
                      {it.remarks ? <p className="mt-0.5 text-xs italic text-neutral-500">{it.remarks}</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" onClick={() => startEdit(it)} aria-label={`Edit ${it.name}`} className="rounded-lg p-1.5 text-neutral-400 hover:text-app-text"><Pencil size={16} /></button>
                      <button type="button" onClick={() => setConfirmId(it.itemId)} aria-label={`Delete ${it.name}`} className="rounded-lg p-1.5 text-neutral-500 hover:text-brand-crimson"><Trash2 size={16} /></button>
                    </div>
                  </div>
                  {confirmId === it.itemId && (
                    <div className="mt-2 flex items-center justify-between rounded-lg border border-brand-crimson/40 bg-brand-crimson/10 px-3 py-2">
                      <p className="text-xs text-brand-crimson">Delete this item?</p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setConfirmId(null)} className="rounded-md px-2 py-1 text-xs text-neutral-300">Cancel</button>
                        <button type="button" onClick={() => remove(it.itemId)} className="rounded-md bg-brand-crimson px-2.5 py-1 text-xs font-semibold text-white">Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </>
  )

  const f = editing?.form
  const form = editing && (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-app-text">{editing.id ? 'Edit' : 'Add'} — {CATEGORY_TITLE[f.category]}</p>
      <div>
        <label className={labelClass}>{f.category === 'pallet' ? 'Classification' : f.category === 'scale' ? 'Type' : 'Item'}</label>
        {f.category === 'pallet' ? (
          <select value={f.name} onChange={(e) => setForm({ name: e.target.value })} className={`${inputClass} mt-1`}>
            {PALLET_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <input type="text" list={f.category === 'other' ? 'logistics-suggestions' : undefined} value={f.name} onChange={(e) => setForm({ name: e.target.value })}
            placeholder={f.category === 'scale' ? 'e.g. Mechanical (1,000 kg)' : 'e.g. Tarpaulin'} className={`${inputClass} mt-1`} />
        )}
        <datalist id="logistics-suggestions">{SUGGESTED_ITEMS.map((n) => <option key={n} value={n} />)}</datalist>
      </div>
      {f.category === 'scale' && (
        <div>
          <label className={labelClass}>Serial no(s).</label>
          <input type="text" value={f.serials} onChange={(e) => setForm({ serials: e.target.value })} placeholder="e.g. 90208 / 110105" className={`${inputClass} mt-1`} />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {FIELDS[f.category].map(([key, label]) => (
          <div key={key}>
            <label className={labelClass}>{label}</label>
            <input type="text" inputMode="numeric" value={f[key]} onChange={(e) => setForm({ [key]: e.target.value.replace(/[^\d]/g, '') })} className={`${inputClass} mt-1 text-center`} />
          </div>
        ))}
      </div>
      <div>
        <label className={labelClass}>Remarks</label>
        <input type="text" value={f.remarks} onChange={(e) => setForm({ remarks: e.target.value })} className={`${inputClass} mt-1`} />
      </div>
    </div>
  )

  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 transition-opacity duration-200 sm:items-center sm:p-4 ${entered ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-neutral-800 bg-neutral-950 transition-transform duration-200 sm:rounded-2xl"
        style={{ transform: entered ? 'translateY(0)' : 'translateY(24px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div className="flex items-center gap-2">
            {editing && (
              <button type="button" onClick={() => setEditing(null)} aria-label="Back" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><ArrowLeft size={18} /></button>
            )}
            <div>
              <h2 className="text-base font-semibold text-app-text">Logistics Inventory</h2>
              <p className="text-xs text-neutral-500">{currentWarehouse?.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">{editing ? form : list}</div>

        <div className="flex gap-2 border-t border-neutral-800 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {editing ? (
            <>
              <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-neutral-800 px-4 py-3 text-sm font-medium text-neutral-400 active:scale-95">Cancel</button>
              <button type="button" onClick={save}
                className="flex-1 rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95">
                {editing.id ? 'Save changes' : 'Add item'}
              </button>
            </>
          ) : (
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95">
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default LogisticsReportModal
