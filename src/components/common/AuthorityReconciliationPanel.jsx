// Authority Reconciliation Panel — shows every WSI (for an AI) or ESI (for
// an SIA) transaction that used a specific AI/SIA number, with a total.
// Used by admins to reconcile a specific AI/SIA against the documents
// issued against it.

import { useLiveQuery } from 'dexie-react-hooks'
import { X } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import { fmtBags, fmtWeight } from '../../utils/calculations.js'

const bySerial = (a, b) => {
  const n = (x) => parseInt((x.serialNo ?? '').replace(/\D/g, ''), 10) || 0
  return n(a) - n(b)
}

function AuthorityReconciliationPanel({ authority, onClose }) {
  const { weightUnit } = useSettings() ?? {}
  const isAi = authority.type === 'AI'
  const refNumber = isAi ? authority.aiNumber : authority.siaNumber

  const transactions = useLiveQuery(async () => {
    if (!refNumber) return []
    if (isAi) {
      return db.transactions
        .where('type').equals('WSI')
        .and((t) => t.aiNumber === refNumber && t.status === 'Active')
        .toArray()
    }
    return db.transactions
      .where('type').equals('ESI')
      .and((t) => t.siaNumber === refNumber && t.status === 'Active')
      .toArray()
  }, [refNumber, isAi])

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const sackTypes = useLiveQuery(() => db.sackTypes.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))

  const rows = [...(transactions ?? [])].sort(bySerial)

  const totalBags = rows.reduce((s, t) => s + (t.numberOfBags ?? 0), 0)
  const totalKilos = rows.reduce((s, t) => s + (t.netKilos ?? 0), 0)
  const totalPieces = rows.reduce(
    (s, t) => s + (t.sackLines ?? []).reduce((ls, l) => ls + (l.pieces ?? 0), 0),
    0
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      <div className="border-b border-neutral-800 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-app-text">
              {authority.type} {refNumber}
            </h1>
            <p className="mt-0.5 text-xs text-neutral-500">
              {isAi ? 'WSI documents using this AI' : 'ESI documents using this SIA'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-900 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">
            No {isAi ? 'WSI' : 'ESI'} documents reference this {authority.type} yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((t) => (
              <li key={t.id} className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-app-text">{t.serialNo}</span>
                      <span className="text-xs text-neutral-500">{t.date}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-app-text">{t.customerName}</p>
                    {!isAi && (
                      <div className="mt-0.5 flex flex-wrap gap-1.5">
                        {(t.sackLines ?? []).map((l, i) => (
                          <span key={i} className="text-xs text-neutral-500">
                            {sackTypeMap.get(l.sackTypeId)?.code ?? '?'}/{l.condition}: {fmtBags(l.pieces ?? 0)}
                          </span>
                        ))}
                      </div>
                    )}
                    {isAi && (
                      <p className="text-xs text-neutral-500">
                        {varietyMap.get(t.varietyId)?.name ?? ''}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {isAi ? (
                      <>
                        <p className="text-sm font-semibold text-app-text">{fmtBags(t.numberOfBags)} bags</p>
                        <p className="text-xs text-neutral-400">{fmtWeight(t.netKilos, weightUnit)}</p>
                      </>
                    ) : (
                      <p className="text-sm font-semibold text-app-text">
                        {fmtBags((t.sackLines ?? []).reduce((s, l) => s + (l.pieces ?? 0), 0))} pcs
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {rows.length > 0 && (
        <div className="border-t border-neutral-800 bg-neutral-900 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-app-text">
              Total ({rows.length} document{rows.length !== 1 ? 's' : ''})
            </span>
            {isAi ? (
              <div className="text-right">
                <span className="text-base font-bold text-brand-neon">{fmtBags(totalBags)} bags</span>
                <span className="ml-3 text-sm text-neutral-400">{fmtWeight(totalKilos, weightUnit)}</span>
              </div>
            ) : (
              <span className="text-base font-bold text-brand-neon">{fmtBags(totalPieces)} pcs</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default AuthorityReconciliationPanel
