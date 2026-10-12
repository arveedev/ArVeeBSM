// Weekly Warehouse Equipment and Logistics Report - the warehouse enters its pallet, platform scale and other
// logistics counts here, then exports the PDF. What was typed is remembered on this device per warehouse
// (under the key below) so next week starts from last week's figures instead of a blank form.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { Plus, Trash2, X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import CalendarDatePicker from './CalendarDatePicker.jsx'
import { generateLogisticsReport } from '../../utils/logisticsReportPdfGenerator.js'
import { sanitizeForFilename, todayLocalISO } from '../../utils/calculations.js'

const PALLET_CLASSES = ['SERVICEABLE', 'UNSERVICEABLE', 'FOR REPAIR']
const LOGISTIC_ITEMS = ['TARPAULIN', 'SACKOLINE', 'BAG CLOSER', 'FUMIGATING SHEETS']

const blankData = () => ({
  palletRows: PALLET_CLASSES.map((classification) => ({ classification, utilized: '', available: '', transfer: '', remarks: '' })),
  scaleRows: [{ type: 'MECHANICAL (1,000 KG)', serials: '', serviceable: '', forRepair: '', unserviceable: '', remarks: '' }],
  logisticRows: LOGISTIC_ITEMS.map((name) => ({ name, brandNew: '', serviceable: '', unserviceable: '', remarks: '' })),
})

const storageKey = (warehouseId) => `logistics-report:${warehouseId}`
const loadSaved = (warehouseId) => {
  try {
    const raw = localStorage.getItem(storageKey(warehouseId))
    if (!raw) return blankData()
    const saved = JSON.parse(raw)
    const base = blankData()
    return {
      palletRows: Array.isArray(saved.palletRows) && saved.palletRows.length === 3 ? saved.palletRows : base.palletRows,
      scaleRows: Array.isArray(saved.scaleRows) ? saved.scaleRows : base.scaleRows,
      logisticRows: Array.isArray(saved.logisticRows) && saved.logisticRows.length ? saved.logisticRows : base.logisticRows,
    }
  } catch {
    return blankData()
  }
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const inputClass = 'w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-sm text-app-text outline-none focus:border-brand-neon'
const labelClass = 'text-[10px] font-semibold uppercase tracking-wide text-neutral-500'

function Num({ label, value, onChange }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input type="text" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))} className={`${inputClass} mt-1 text-center`} />
    </div>
  )
}

function LogisticsReportModal({ onClose }) {
  const { user } = useAuth()
  const { currentWarehouse, currentWarehouseId } = useWarehouse() ?? {}
  const [dateTo, setDateTo] = useState(() => todayLocalISO())
  const [dateFrom, setDateFrom] = useState(() => addDays(todayLocalISO(), -6))
  const [data, setData] = useState(() => loadSaved(currentWarehouseId))
  const [generating, setGenerating] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const patch = (key, i, field, value) => setData((d) => ({ ...d, [key]: d[key].map((r, k) => (k === i ? { ...r, [field]: value } : r)) }))

  const clearAll = () => setData(blankData())

  const handleExport = async () => {
    if (!currentWarehouse) { toast.error('No warehouse selected'); return }
    setGenerating(true)
    try {
      try { localStorage.setItem(storageKey(currentWarehouseId), JSON.stringify(data)) } catch { /* private mode: just not remembered */ }
      const province = currentWarehouse.provinceId ? await db.provinces.get(currentWarehouse.provinceId) : null
      const branch = province?.branchId ? await db.branches.get(province.branchId) : null
      const config = await db.reportConfig.get('global')
      const supervisorSig = user ? await db.signatories.get(user.uid) : null
      const verified = config?.verifiedCorrect ?? []
      const isManager = (p) => /manager/i.test(p?.position ?? '')
      const doc = generateLogisticsReport({
        branch, warehouse: currentWarehouse, province, dateFrom, dateTo,
        data: {
          palletRows: data.palletRows,
          scaleRows: data.scaleRows.filter((r) => r.type || r.serials || r.serviceable || r.forRepair || r.unserviceable || r.remarks),
          logisticRows: data.logisticRows.filter((r) => r.name),
        },
        signatories: {
          certifiedCorrect: { name: user?.name ?? '', position: supervisorSig?.certifiedCorrectPosition || 'Warehouse Supervisor' },
          reviewedBy: verified.filter(isManager),
          verifiedCorrect: verified.filter((p) => !isManager(p)),
          auditedBy: { name: config?.auditedByName ?? '', position: config?.auditedByPosition ?? '' },
          notedBy: { name: config?.notedByName ?? '', position: config?.notedByPosition ?? '' },
        },
      })
      doc.save(`${sanitizeForFilename(currentWarehouse.name) || 'WH'}-Logistics-${dateFrom}-to-${dateTo}.pdf`)
      toast.success('Logistics report exported')
      onClose()
    } catch (err) {
      console.error(err)
      toast.error('Failed to generate the report')
    } finally {
      setGenerating(false)
    }
  }

  const card = 'rounded-xl border border-neutral-800 bg-neutral-900 p-3'

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
          <div>
            <h2 className="text-base font-semibold text-app-text">Weekly Logistics Report</h2>
            <p className="text-xs text-neutral-500">{currentWarehouse?.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>From</label>
              <div className="mt-1"><CalendarDatePicker value={dateFrom} onChange={setDateFrom} valueClassName="text-sm" /></div>
            </div>
            <div>
              <label className={labelClass}>To</label>
              <div className="mt-1"><CalendarDatePicker value={dateTo} onChange={setDateTo} valueClassName="text-sm" /></div>
            </div>
          </div>

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-brand-neon">Wooden pallets</h3>
            <div className="mt-2 space-y-2">
              {data.palletRows.map((r, i) => (
                <div key={r.classification} className={card}>
                  <p className="text-sm font-semibold text-app-text">{r.classification}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Num label="Utilized" value={r.utilized} onChange={(v) => patch('palletRows', i, 'utilized', v)} />
                    <Num label="Available" value={r.available} onChange={(v) => patch('palletRows', i, 'available', v)} />
                    <Num label="Transfer" value={r.transfer} onChange={(v) => patch('palletRows', i, 'transfer', v)} />
                  </div>
                  <input type="text" value={r.remarks} onChange={(e) => patch('palletRows', i, 'remarks', e.target.value)} placeholder="Remarks" className={`${inputClass} mt-2`} />
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-brand-neon">Platform scale</h3>
              <button type="button" onClick={() => setData((d) => ({ ...d, scaleRows: [...d.scaleRows, { type: 'MECHANICAL (1,000 KG)', serials: '', serviceable: '', forRepair: '', unserviceable: '', remarks: '' }] }))}
                className="flex items-center gap-1 text-xs font-medium text-brand-neon"><Plus size={14} /> Add scale</button>
            </div>
            <div className="mt-2 space-y-2">
              {data.scaleRows.map((r, i) => (
                <div key={i} className={card}>
                  <div className="flex gap-2">
                    <input type="text" value={r.type} onChange={(e) => patch('scaleRows', i, 'type', e.target.value)} placeholder="Type, e.g. Mechanical (1,000 kg)" className={inputClass} />
                    <button type="button" onClick={() => setData((d) => ({ ...d, scaleRows: d.scaleRows.filter((_, k) => k !== i) }))} aria-label="Remove scale" className="shrink-0 rounded-lg px-2 text-neutral-500 hover:text-brand-crimson"><Trash2 size={16} /></button>
                  </div>
                  <input type="text" value={r.serials} onChange={(e) => patch('scaleRows', i, 'serials', e.target.value)} placeholder="Serial no(s)., e.g. 90208 / 110105" className={`${inputClass} mt-2`} />
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Num label="Serviceable" value={r.serviceable} onChange={(v) => patch('scaleRows', i, 'serviceable', v)} />
                    <Num label="For repair" value={r.forRepair} onChange={(v) => patch('scaleRows', i, 'forRepair', v)} />
                    <Num label="Unserviceable" value={r.unserviceable} onChange={(v) => patch('scaleRows', i, 'unserviceable', v)} />
                  </div>
                  <input type="text" value={r.remarks} onChange={(e) => patch('scaleRows', i, 'remarks', e.target.value)} placeholder="Remarks" className={`${inputClass} mt-2`} />
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-brand-neon">Other logistics</h3>
              <button type="button" onClick={() => setData((d) => ({ ...d, logisticRows: [...d.logisticRows, { name: '', brandNew: '', serviceable: '', unserviceable: '', remarks: '' }] }))}
                className="flex items-center gap-1 text-xs font-medium text-brand-neon"><Plus size={14} /> Add item</button>
            </div>
            <div className="mt-2 space-y-2">
              {data.logisticRows.map((r, i) => (
                <div key={i} className={card}>
                  <div className="flex gap-2">
                    <input type="text" value={r.name} onChange={(e) => patch('logisticRows', i, 'name', e.target.value)} placeholder="Item name" className={`${inputClass} font-semibold`} />
                    <button type="button" onClick={() => setData((d) => ({ ...d, logisticRows: d.logisticRows.filter((_, k) => k !== i) }))} aria-label="Remove item" className="shrink-0 rounded-lg px-2 text-neutral-500 hover:text-brand-crimson"><Trash2 size={16} /></button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Num label="Brand new" value={r.brandNew} onChange={(v) => patch('logisticRows', i, 'brandNew', v)} />
                    <Num label="Serviceable" value={r.serviceable} onChange={(v) => patch('logisticRows', i, 'serviceable', v)} />
                    <Num label="Unserviceable" value={r.unserviceable} onChange={(v) => patch('logisticRows', i, 'unserviceable', v)} />
                  </div>
                  <input type="text" value={r.remarks} onChange={(e) => patch('logisticRows', i, 'remarks', e.target.value)} placeholder="Remarks" className={`${inputClass} mt-2`} />
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex gap-2 border-t border-neutral-800 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={clearAll} className="rounded-xl border border-neutral-800 px-4 py-3 text-sm font-medium text-neutral-400 active:scale-95">Clear</button>
          <button type="button" onClick={handleExport} disabled={generating}
            className="flex-1 rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 active:scale-95 disabled:opacity-40">
            {generating ? 'Generating…' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default LogisticsReportModal
