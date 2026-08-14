// Drill-down behind an "unwithdrawn" badge (HomeStocks.jsx,
// AdminHomeStocks.jsx) - shows every active AI contributing to that
// number, each with its own allocated/withdrawn/unwithdrawn split (in
// net bags, i.e. kilos / 50 - the same unit as everywhere else this
// figure is shown, not the separately-tracked bag-count field), and
// every WSI/WTS document actually withdrawn against it.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { fmtNetBags } from '../../utils/calculations.js'
import { getUnwithdrawnDetail } from '../../utils/unwithdrawnStock.js'

const netBagsOf = (kilos) => (kilos ?? 0) / 50

function UnwithdrawnDetailModal({ warehouseId, varietyIds, title, subtitle, onClose }) {
  const [isClosing, setIsClosing] = useState(false)
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(onClose, 250)
  }

  const detail = useLiveQuery(
    () => getUnwithdrawnDetail(warehouseId, varietyIds),
    [warehouseId, JSON.stringify(varietyIds)]
  ) ?? []
  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))

  const totalAllocatedNetBags = detail.reduce((s, d) => s + netBagsOf(d.allocatedKilos), 0)
  const totalWithdrawnNetBags = detail.reduce((s, d) => s + netBagsOf(d.withdrawnKilos), 0)
  const totalUnwithdrawnNetBags = detail.reduce((s, d) => s + netBagsOf(d.unwithdrawnKilos), 0)

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
              <p className="text-[10px] uppercase text-neutral-500">Authorized</p>
              <p className="text-sm font-bold text-app-text">{fmtNetBags(totalAllocatedNetBags)}</p>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
              <p className="text-[10px] uppercase text-neutral-500">Withdrawn</p>
              <p className="text-sm font-bold text-brand-neon">{fmtNetBags(totalWithdrawnNetBags)}</p>
            </div>
            <div className="rounded-lg border border-red-400/30 bg-red-400/5 p-2">
              <p className="text-[10px] uppercase text-red-400/80">Unwithdrawn</p>
              <p className="text-sm font-bold text-red-400">{fmtNetBags(totalUnwithdrawnNetBags)}</p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-3">
          {detail.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-500">Nothing unwithdrawn right now.</p>
          ) : (
            <div className="space-y-4">
              {detail.map((d) => {
                const unwithdrawnNetBags = netBagsOf(d.unwithdrawnKilos)
                const allocatedNetBags = netBagsOf(d.allocatedKilos)
                const withdrawnNetBags = netBagsOf(d.withdrawnKilos)
                // Rounds-to-zero (see the badge fix elsewhere) counts as
                // fully withdrawn, not a lingering red "0.00" - a card
                // with nothing left owing is good news, shown in green.
                const isFullyWithdrawn = unwithdrawnNetBags < 0.005
                return (
                  <div
                    key={d.authority.authId}
                    className={`rounded-xl border p-3 ${isFullyWithdrawn ? 'border-brand-neon/50 bg-brand-neon/5' : 'border-neutral-800 bg-neutral-950'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-bold text-app-text">AI {d.authority.aiNumber}</p>
                        <p className="truncate text-xs text-neutral-500">
                          {varietyMap.get(d.authority.varietyId)?.name ?? '—'}
                          {d.authority.customerName ? ` · ${d.authority.customerName}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {isFullyWithdrawn ? (
                          <>
                            <p className="text-sm font-semibold text-brand-neon">{fmtNetBags(withdrawnNetBags)} withdrawn</p>
                            <p className="text-xs text-neutral-500">{fmtNetBags(allocatedNetBags)} allocated</p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-semibold text-red-400">{fmtNetBags(unwithdrawnNetBags)} unwithdrawn</p>
                            <p className="text-xs text-neutral-500">
                              {fmtNetBags(allocatedNetBags)} allocated · {fmtNetBags(withdrawnNetBags)} withdrawn
                            </p>
                          </>
                        )}
                      </div>
                    </div>

                    {d.withdrawals.length > 0 && (
                      <ul className="mt-2 space-y-1.5 border-t border-neutral-800 pt-2">
                        {d.withdrawals.map((t) => (
                          <li key={t.id} className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-300">
                                  {t.type}
                                </span>
                                <span className="font-mono text-sm font-semibold text-app-text">{t.serialNo}</span>
                                <span className="text-xs text-neutral-500">{t.date}</span>
                              </div>
                              <p className="mt-0.5 truncate text-xs text-neutral-400">
                                {varietyMap.get(t.varietyId)?.name ?? '—'}
                                {t.customerName ? ` · ${t.customerName}` : ''}
                              </p>
                            </div>
                            <span className="shrink-0 text-xs text-neutral-300">
                              {fmtNetBags(netBagsOf(t.type === 'WSI' ? t.netKilos : t.issuedNetKilos))} bags
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
