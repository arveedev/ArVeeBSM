// Drill-down behind an "unwithdrawn" badge (HomeStocks.jsx,
// AdminHomeStocks.jsx) - shows every active AI contributing to that
// number, each with its own allocated/withdrawn/unwithdrawn split, and
// every WSI/WTS document actually withdrawn against it.
//
// rawBags (passed by the caller, true for a By Products drill-down):
// By Products bags don't have a standard 50kg weight, so the usual
// "net bags" figure (kilos / 50) used for Rice/Palay doesn't apply -
// the AI's own typed bag count is the real, authoritative figure there
// instead (via allocatedBags/withdrawnBags/unwithdrawnBags, already
// computed by getUnwithdrawnDetail). Per explicit direction, net kg is
// now the single source of truth everywhere a bag COUNT is shown in
// this app: unwithdrawnStock.js's own resolveBags() falls back to
// kilos / 50 whenever a typed bag count is missing/zero (a real,
// confirmed bug - a 0-typed-bags AI with real kilos was showing as
// having nothing unwithdrawn, dragging a whole variety's total below
// its true figure). Since a typed bag count and its kilos-derived
// figure can therefore never meaningfully "disagree" any more, the
// "Bags/Kgs don't match" warning this modal used to show has been
// removed entirely, for every category - it would only ever have been
// reporting normal bag-weight variance, not a real data problem.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { fmtBags, fmtKilos, fmtNetBags, authorityExtraDetails } from '../../utils/calculations.js'
import { getUnwithdrawnDetail, resolveBags } from '../../utils/unwithdrawnStock.js'

const netBagsOf = (kilos) => (kilos ?? 0) / 50

function UnwithdrawnDetailModal({ warehouseId, varietyIds, bucketFilter, title, subtitle, rawBags = false, onClose }) {
  const [isClosing, setIsClosing] = useState(false)
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(onClose, 250)
  }

  // The modal has its own internal scroll region, but without this the
  // page behind it is still technically scrollable even though visually
  // covered - producing two scrollbars at once.
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const detail = useLiveQuery(
    () => getUnwithdrawnDetail(warehouseId, varietyIds, bucketFilter),
    [warehouseId, JSON.stringify(varietyIds), JSON.stringify(bucketFilter)]
  ) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  // Reported: this modal showed far less detail per AI than the
  // Monitoring list it's drilled down from - just variety + a truncated
  // customer name, missing the warehouse, date, and OR No./Remarks/Note
  // fields already stored on every authority record. Reuses the same
  // authorityExtraDetails helper AdminMonitoring.jsx's own row already
  // uses, for the exact same "OR No.: ... · Note: ..." text.
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w]))

  const totalAllocatedKilos = detail.reduce((s, d) => s + d.allocatedKilos, 0)
  const totalWithdrawnKilos = detail.reduce((s, d) => s + d.withdrawnKilos, 0)
  const totalUnwithdrawnKilos = detail.reduce((s, d) => s + d.unwithdrawnKilos, 0)
  const totalAllocatedBagsVal = rawBags
    ? detail.reduce((s, d) => s + d.allocatedBags, 0)
    : detail.reduce((s, d) => s + netBagsOf(d.allocatedKilos), 0)
  const totalWithdrawnBagsVal = rawBags
    ? detail.reduce((s, d) => s + d.withdrawnBags, 0)
    : detail.reduce((s, d) => s + netBagsOf(d.withdrawnKilos), 0)
  const totalUnwithdrawnBagsVal = rawBags
    ? detail.reduce((s, d) => s + d.unwithdrawnBags, 0)
    : detail.reduce((s, d) => s + netBagsOf(d.unwithdrawnKilos), 0)
  const fmtBagsVal = rawBags ? fmtBags : fmtNetBags
  const bagsUnitLabel = rawBags ? 'bags' : 'net bags'

  return createPortal(
    <div className={`fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`} onClick={handleClose}>
      <div
        className={`flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-neutral-800 bg-neutral-900 ${isClosing ? 'animate-sheet-slide-down' : 'animate-sheet-slide-up'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-neutral-800 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-base font-bold text-app-text">{title}</p>
              {subtitle && <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="rounded-full p-2 text-brand-crimson transition-transform active:scale-90"
            >
              <X size={22} strokeWidth={2.5} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
              <p className="text-[9px] uppercase text-neutral-500">Authorized</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-app-text">{fmtBagsVal(totalAllocatedBagsVal)}</p>
              <p className="text-[9px] text-neutral-600">{bagsUnitLabel}</p>
              <p className="text-[10px] tabular-nums text-neutral-500">{fmtKilos(totalAllocatedKilos)} kg</p>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
              <p className="text-[9px] uppercase text-neutral-500">Withdrawn</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-brand-neon">{fmtBagsVal(totalWithdrawnBagsVal)}</p>
              <p className="text-[9px] text-neutral-600">{bagsUnitLabel}</p>
              <p className="text-[10px] tabular-nums text-neutral-500">{fmtKilos(totalWithdrawnKilos)} kg</p>
            </div>
            <div className="rounded-lg border border-red-400/30 bg-red-400/5 p-2">
              <p className="text-[9px] uppercase text-red-400/80">Unwithdrawn</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-red-400">{fmtBagsVal(totalUnwithdrawnBagsVal)}</p>
              <p className="text-[9px] text-red-400/60">{bagsUnitLabel}</p>
              <p className="text-[10px] tabular-nums text-red-400/70">{fmtKilos(totalUnwithdrawnKilos)} kg</p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-3">
          {detail.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-500">Nothing unwithdrawn right now.</p>
          ) : (
            <div className="space-y-4">
              {detail.map((d) => {
                const unwithdrawnVal = rawBags ? d.unwithdrawnBags : netBagsOf(d.unwithdrawnKilos)
                const withdrawnVal = rawBags ? d.withdrawnBags : netBagsOf(d.withdrawnKilos)
                // Rounds-to-zero (see the badge fix elsewhere) counts as
                // fully withdrawn, not a lingering red "0.00" - a card
                // with nothing left owing is good news, shown in green.
                const isFullyWithdrawn = unwithdrawnVal < 0.005
                return (
                  <div
                    key={d.authority.authId}
                    className={`rounded-xl border p-3 ${isFullyWithdrawn ? 'border-brand-neon/50 bg-brand-neon/5' : 'border-neutral-800 bg-neutral-950'}`}
                  >
                    {/* Every detail line always renders in full, never
                        truncated - a reported, real issue where the
                        warehouse/date/OR-No. lines could get clipped or
                        dropped on a narrow screen. This block always
                        takes the card's full width; the figures move to
                        their own row below instead of squeezing beside
                        it, so there's never a reason to cut anything
                        here short. */}
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold text-app-text">AI {d.authority.aiNumber}</p>
                      <p className="break-words text-xs text-neutral-500">
                        {varietyMap.get(d.authority.varietyId)?.name ?? '—'}
                        {d.authority.customerName ? ` · ${d.authority.customerName}` : ''}
                      </p>
                      {(() => {
                        const warehouse = warehouseMap.get(d.authority.assignedWarehouse)
                        return (warehouse || d.authority.assignedWarehouse) && (
                          <p className="break-words text-xs text-neutral-500">
                            {warehouse ? `${warehouse.code} — ${warehouse.name}` : d.authority.assignedWarehouse}
                          </p>
                        )
                      })()}
                      {d.authority.date && (
                        <p className="break-words text-xs text-neutral-600">{String(d.authority.date).slice(0, 10)}</p>
                      )}
                      {d.authority.ageGroup && (
                        <p className="mt-0.5 inline-block break-words rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-400">
                          Age Group: {d.authority.ageGroup}
                        </p>
                      )}
                      {authorityExtraDetails(d.authority).filter((x) => x.label !== 'Age Group').length > 0 && (
                        <p className="mt-0.5 break-words text-xs text-neutral-600">
                          {authorityExtraDetails(d.authority)
                            .filter((x) => x.label !== 'Age Group')
                            .map((x) => `${x.label}: ${x.value}`)
                            .join(' · ')}
                        </p>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-neutral-800 pt-2">
                      <div className={`rounded-lg p-2 text-center ${unwithdrawnVal >= 0.005 ? 'border border-red-400/30 bg-red-400/5' : 'bg-neutral-900'}`}>
                        <p className="text-[9px] uppercase text-red-400/80">Unwithdrawn</p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-red-400">{fmtBagsVal(unwithdrawnVal)}</p>
                        <p className="text-[10px] tabular-nums text-red-400/70">{fmtKilos(d.unwithdrawnKilos)} kg</p>
                      </div>
                      <div className="rounded-lg bg-neutral-900 p-2 text-center">
                        <p className="text-[9px] uppercase text-neutral-500">Withdrawn</p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-brand-neon">{fmtBagsVal(withdrawnVal)}</p>
                        <p className="text-[10px] tabular-nums text-neutral-500">{fmtKilos(d.withdrawnKilos)} kg</p>
                      </div>
                    </div>

                    {d.withdrawals.length > 0 && (
                      <ul className="mt-2 space-y-1.5 border-t border-neutral-800 pt-2">
                        {d.withdrawals.map((t) => (
                          <li key={t.id} className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-300">
                                  {t.type}
                                </span>
                                <span className="font-mono text-sm font-semibold text-app-text">{t.serialNo}</span>
                                <span className="text-xs text-neutral-500">{t.date}</span>
                              </div>
                              <p className="mt-0.5 break-words text-xs text-neutral-400">
                                {varietyMap.get(t.varietyId)?.name ?? '—'}
                                {t.customerName ? ` · ${t.customerName}` : ''}
                              </p>
                            </div>
                            <span className="shrink-0 text-right text-xs tabular-nums text-neutral-300">
                              {rawBags
                                ? `${fmtBags(resolveBags(t.type === 'WSI' ? (t.numberOfBags ?? 0) : (t.issuedBags ?? 0), t.type === 'WSI' ? t.netKilos : t.issuedNetKilos))} bags`
                                : `${fmtNetBags(netBagsOf(t.type === 'WSI' ? t.netKilos : t.issuedNetKilos))} bags`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {d.withdrawals.length === 0 && (
                      <p className="mt-2 border-t border-neutral-800 pt-2 text-xs text-neutral-500">
                        No WSI/WTS documents issued against this AI yet.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default UnwithdrawnDetailModal
