// Total CPF history (Admin/Visitor, Monitoring > Procurement). One card per
// update - a replenishment, a liquidation or a Cash in Bank change - newest
// first. Opening a card shows the Total CPF as it stood right after that
// update: every SDO's Cash on Hand grouped by province with a subtotal per
// province, then Cash in Bank, then the Total. Read-only. See utils/cpfHistory.js.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { buildCpfHistory } from '../../utils/cpfHistory.js'

const fmtPeso = (n) => `${n < 0 ? '-' : ''}₱${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? String(iso ?? '') : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CpfHistoryModal({ onClose }) {
  const [entered, setEntered] = useState(false)
  const [openId, setOpenId] = useState(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const sdoUsers = useLiveQuery(() => db.users.where('role').equals('SDO').toArray(), [])
  const ledger = useLiveQuery(() => db.cashLedgerV2.toArray(), [])
  const activePrs = useLiveQuery(() => db.purchaseReceipts.where('status').equals('Active').toArray(), [])
  const config = useLiveQuery(() => db.reportConfig.get('global'), [])
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), [])
  const provinces = useLiveQuery(() => db.provinces.toArray(), [])

  const loading = [sdoUsers, ledger, activePrs, warehouses, provinces].some((x) => x === undefined)
  const events = useMemo(
    () => (loading ? [] : buildCpfHistory({ sdoUsers, ledger, activePrs, config, warehouses, provinces })),
    [loading, sdoUsers, ledger, activePrs, config, warehouses, provinces]
  )
  const expandedId = openId ?? events[0]?.id

  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ transform: entered ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-app-text">Total CPF History</h2>
            <p className="text-xs text-neutral-500">Per update, newest first</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg bg-neutral-900 p-1.5 text-neutral-400"><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {loading && <p className="py-6 text-center text-sm text-neutral-500">Loading…</p>}
          {!loading && events.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">No updates yet.</p>}
          {events.map((ev) => {
            const open = ev.id === expandedId
            const snap = ev.snapshot
            return (
              <div key={ev.id} className="rounded-xl border border-neutral-800 bg-neutral-900">
                <button type="button" onClick={() => setOpenId(open ? '' : ev.id)} className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left">
                  <div className="min-w-0">
                    <p className="text-xs text-neutral-500">{fmtDate(ev.date)}</p>
                    <p className="break-words text-sm font-semibold text-app-text">{ev.title}</p>
                    {(ev.amount != null || ev.detail) && (
                      <p className="text-xs text-neutral-500">
                        {ev.amount != null && <span className={ev.amount < 0 ? 'text-brand-crimson' : 'text-brand-neon'}>{ev.amount < 0 ? '−' : '+'}{fmtPeso(Math.abs(ev.amount))}</span>}
                        {ev.amount != null && ev.detail ? ' · ' : ''}{ev.detail}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-neutral-500">Total CPF</p>
                      <p className="text-sm font-bold tabular-nums text-app-text">{fmtPeso(snap.total)}</p>
                    </div>
                    <ChevronDown size={16} className={`text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {open && (
                  <div className="space-y-2 border-t border-neutral-800 px-3 py-2.5">
                    {snap.provinces.map((p) => (
                      <div key={p.name} className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-brand-neon">{p.name}</p>
                        {p.sdos.map((s) => (
                          <div key={s.uid} className="mt-1 flex items-baseline justify-between gap-3 text-sm">
                            <span className="min-w-0 break-words text-neutral-300">{s.name}</span>
                            <span className={`shrink-0 tabular-nums ${s.cash < 0 ? 'text-brand-crimson' : 'text-app-text'}`}>{fmtPeso(s.cash)}</span>
                          </div>
                        ))}
                        <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-neutral-800 pt-1.5 text-sm font-semibold">
                          <span className="text-neutral-400">Subtotal — {p.name}</span>
                          <span className="tabular-nums text-app-text">{fmtPeso(p.subtotal)}</span>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-2 text-sm">
                      <span className="font-semibold text-app-text">Cash in Bank</span>
                      <span className="tabular-nums text-app-text">{snap.cashInBank == null ? 'Not recorded' : fmtPeso(snap.cashInBank)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 rounded-lg border border-brand-neon/40 bg-brand-neon/5 px-2 py-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-brand-neon">Total CPF</span>
                      <span className="text-base font-bold tabular-nums text-app-text">{fmtPeso(snap.total)}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default CpfHistoryModal
