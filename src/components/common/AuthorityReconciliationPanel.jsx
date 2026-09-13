// Authority Reconciliation Panel — shows every WSI (for an AI) or ESI (for
// an SIA) transaction that used a specific AI/SIA number, with a total.
// Used by admins to reconcile a specific AI/SIA against the documents
// issued against it.

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, ChevronDown } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { useSettings } from '../../context/SettingsContext.jsx'
import { fmtBags, fmtWeight, fmtNetBags } from '../../utils/calculations.js'

// Newest first, per explicit request - a reconciliation view is read
// most often right after the latest document was posted, not from the
// oldest one forward.
const byDateDesc = (a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0)

function AuthorityReconciliationPanel({ authority, onClose }) {
  const [isClosing, setIsClosing] = useState(false)
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(onClose, 250)
  }

  const { weightUnit } = useSettings() ?? {}
  const isAi = authority.type === 'AI'
  const refNumber = isAi ? authority.aiNumber : authority.siaNumber
  // AI figures are shown as Net Kg by default, with an in-header toggle
  // to switch to their Net Bags equivalent (kilos / 50, same conversion
  // already used elsewhere e.g. MillingMonitor.jsx) - per explicit
  // request. SIA has no such toggle - it's pieces only.
  const [showBags, setShowBags] = useState(false)

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
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))
  const warehouseMap = new Map(warehouses.map((w) => [w.warehouseId, w.name]))

  const rows = [...(transactions ?? [])].sort(byDateDesc)

  const totalBags = rows.reduce((s, t) => s + (t.numberOfBags ?? 0), 0)
  const totalKilos = rows.reduce((s, t) => s + (t.netKilos ?? 0), 0)
  const totalPieces = rows.reduce(
    (s, t) => s + (t.sackLines ?? []).reduce((ls, l) => ls + (l.pieces ?? 0), 0),
    0
  )

  // Remaining - the authority's own authorized allocation minus what
  // this ledger shows as actually issued so far, per explicit request.
  // AI carries its allocation as flat top-level fields; a SIA's
  // allocation lives per-line (sackLines[].totalAllocationBags, only
  // for lines that actually have one set) - matches the same
  // hasAllocation check AuthorityMonitor's own handleOpen already uses.
  // null (not 0) when no allocation is on file at all, so the UI can
  // show "—" rather than a misleading "0 remaining".
  const kilosRemaining = isAi && authority.totalAllocationKilos != null
    ? parseFloat((authority.totalAllocationKilos - totalKilos).toFixed(3))
    : null
  const bagsRemaining = isAi && authority.totalAllocationBags != null
    ? authority.totalAllocationBags - totalBags
    : null
  const siaAllocatedLines = (authority.sackLines ?? []).filter((l) => l.totalAllocationBags != null)
  const piecesRemaining = !isAi && siaAllocatedLines.length > 0
    ? siaAllocatedLines.reduce((s, l) => s + l.totalAllocationBags, 0) - totalPieces
    : null

  // Total card tap-to-expand, revealing Remaining below Issued - grows
  // when tapped, shrinks when tapped again, tapped anywhere else on
  // screen, or the whole panel is closed. The Remaining block stays
  // permanently mounted with its height/opacity animated via inline
  // style (same maxWidth/opacity "shrink-beside-grow" technique already
  // used for Classifier's Cancel button and the Sack Condition column) -
  // a mount/unmount pairing (useDelayedUnmount + a CSS animation class)
  // was tried first but only animates the CONTENT's opacity/translate,
  // not the card's own height, so the surrounding box still snapped to
  // its new size instantly - not smooth. Same real click-outside
  // listener already used by Settings.jsx's ClassifierSection (a
  // scoped absolutely-positioned overlay was tried first but only
  // covered the ledger list, not the header or the card itself, so
  // tapping anywhere else didn't collapse it).
  const [totalExpanded, setTotalExpanded] = useState(false)
  const hasRemainingData = kilosRemaining != null || bagsRemaining != null || piecesRemaining != null
  const totalCardRef = useRef(null)
  useEffect(() => {
    if (!totalExpanded) return
    const handleClickOutside = (e) => {
      if (totalCardRef.current && !totalCardRef.current.contains(e.target)) setTotalExpanded(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [totalExpanded])

  // Portaled straight to document.body - opened both from AuthorityMonitor
  // directly and from inside CompletedAuthorityModal, both of which on
  // Home.jsx sit under a `.stagger-fields`/`.animate-flow-down`
  // ancestor whose `animation-fill-mode: both` leaves a lingering
  // non-`none` transform applied even after the animation finishes -
  // that becomes the containing block for `position: fixed`
  // descendants instead of the real viewport, which is what rendered
  // this panel inline in the page flow instead of covering the screen
  // (same bug fixed for the other Authority/Milling modals this
  // session).
  const netLabel = showBags ? 'Net Bags' : 'Net Kg'
  const netValueOf = (kilos) => (showBags ? fmtNetBags(kilos != null ? kilos / 50 : null) : fmtWeight(kilos, weightUnit).replace(/\s*(kg|MT)$/, ''))

  return createPortal(
    <div className={`fixed inset-0 z-50 flex flex-col bg-neutral-950 ${isClosing ? 'animate-push-slide-out' : 'animate-push-slide-in'}`}>
      {/* Tinted hero band, same convention as CreateEditPileModal/
          ChoiceAuthorityModal - the AI/SIA number is the most important
          thing on this whole screen, so it gets the same prominent
          treatment as the modal that led here, rather than a small
          plain title. Blue for AI, amber for SIA - same type-based tint
          as ChoiceAuthorityModal (this screen has no cereal category of
          its own to tint by). */}
      <div
        style={{ backgroundImage: `linear-gradient(135deg, ${isAi ? 'rgba(96,165,250,.28), rgba(96,165,250,.04)' : 'rgba(242,185,73,.28), rgba(242,185,73,.04)'})` }}
        className="bg-neutral-950 px-4 py-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={`text-xs font-bold uppercase tracking-wide ${isAi ? 'text-blue-300' : 'text-brand-amber'}`}>
              {authority.type} Number
            </span>
            <p className="mt-0.5 break-words text-2xl font-extrabold text-app-text">{refNumber}</p>
            <p className="mt-1 text-sm text-neutral-400">
              {isAi ? 'WSI documents using this AI' : 'ESI documents using this SIA'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-900 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90"
          >
            <X size={18} />
          </button>
        </div>

        {/* AI only - SIA deals exclusively in pieces, no Kg/Bags concept
            to toggle. Same sliding-pill technique as the app's other
            two-way toggles (KG/MT in the header, Stocks/Sacks tabs). */}
        {isAi && (
          <div className="relative mt-3 inline-flex gap-1 rounded-full bg-neutral-900 p-1 text-sm font-bold">
            <div
              className="absolute inset-y-1 w-[calc(50%-2px)] rounded-full bg-brand-neon transition-transform duration-300 ease-out"
              style={{ transform: showBags ? 'translateX(100%)' : 'translateX(0%)' }}
            />
            <button type="button" onClick={() => setShowBags(false)} className={`relative z-10 rounded-full px-3 py-1.5 transition-colors ${!showBags ? 'text-brand-contrast' : 'text-neutral-400'}`}>
              Net Kg
            </button>
            <button type="button" onClick={() => setShowBags(true)} className={`relative z-10 rounded-full px-3 py-1.5 transition-colors ${showBags ? 'text-brand-contrast' : 'text-neutral-400'}`}>
              Net Bags
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">
            No {isAi ? 'WSI' : 'ESI'} documents reference this {authority.type} yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((t) => (
              <li key={t.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-lg font-bold text-app-text">{t.serialNo}</span>
                  <span className="text-sm text-neutral-500">{t.date}</span>
                </div>
                {/* Full name, no truncation - was reported cut off. */}
                <p className="mt-0.5 text-base text-app-text">{t.customerName}</p>
                <p className="text-sm text-neutral-400">{warehouseMap.get(t.warehouseId) ?? '—'}</p>
                {!isAi && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(t.sackLines ?? []).map((l, i) => (
                      <span key={i} className="text-sm tabular-nums text-neutral-500">
                        {sackTypeMap.get(l.sackTypeId)?.code ?? '?'}/{l.condition}: {fmtBags(l.pieces ?? 0)}
                      </span>
                    ))}
                  </div>
                )}
                {isAi && varietyMap.get(t.varietyId)?.name && (
                  <p className="text-sm text-neutral-400">{varietyMap.get(t.varietyId)?.name}</p>
                )}
                {isAi ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-neutral-950 py-2 text-center">
                      <p className="text-xs uppercase tracking-wide text-neutral-500">Bags</p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">{fmtBags(t.numberOfBags)}</p>
                    </div>
                    <div className="rounded-lg bg-neutral-950 py-2 text-center">
                      <p className="text-xs uppercase tracking-wide text-neutral-500">{netLabel}</p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">{netValueOf(t.netKilos)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 rounded-lg bg-neutral-950 py-2 text-center">
                    <p className="text-xs uppercase tracking-wide text-neutral-500">Pieces</p>
                    <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">
                      {fmtBags((t.sackLines ?? []).reduce((s, l) => s + (l.pieces ?? 0), 0))}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Total is its own card now (matching the ledger rows above),
          not a bare footer bar - a neon border marks it as the summary.
          Its own bottom padding includes the device's safe-area inset
          (home-indicator area on mobile), same as every other bottom-
          pinned action bar in the app, so it never sits flush against
          that edge. Tapping it (when there's real allocation data to
          show) grows it to reveal Remaining below Issued - see
          hasRemainingData/totalExpanded above. */}
      {rows.length > 0 && (
        <div className="border-t border-neutral-800 bg-neutral-950 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
          <button
            ref={totalCardRef}
            type="button"
            onClick={() => hasRemainingData && setTotalExpanded((v) => !v)}
            className="w-full rounded-xl border border-brand-neon/50 bg-brand-neon/5 p-3 text-left"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-brand-neon">
                Issued ({rows.length} document{rows.length !== 1 ? 's' : ''})
              </p>
              {hasRemainingData && (
                <ChevronDown size={16} className={`shrink-0 text-brand-neon transition-transform ${totalExpanded ? 'rotate-180' : ''}`} />
              )}
            </div>
            {isAi ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-neutral-950 py-2 text-center">
                  <p className="text-xs uppercase tracking-wide text-neutral-500">Bags</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">{fmtBags(totalBags)}</p>
                </div>
                <div className="rounded-lg bg-neutral-950 py-2 text-center">
                  <p className="text-xs uppercase tracking-wide text-neutral-500">{netLabel}</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-brand-neon">{netValueOf(totalKilos)}</p>
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded-lg bg-neutral-950 py-2 text-center">
                <p className="text-xs uppercase tracking-wide text-neutral-500">Pieces</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-brand-neon">{fmtBags(totalPieces)}</p>
              </div>
            )}

            {/* Always mounted - height AND opacity both animate via
                inline style (not a mount/unmount + CSS-animation-class
                pairing), so the card's own box actually grows/shrinks
                smoothly instead of snapping to its new height while
                only the content inside fades. maxHeight is a generous
                fixed value (not 'auto', which can't transition) well
                above this block's real rendered height. */}
            <div
              className="overflow-hidden transition-all duration-300 ease-out"
              style={{ maxHeight: totalExpanded ? '160px' : '0px', opacity: totalExpanded ? 1 : 0 }}
            >
              <div className="mt-2 border-t border-neutral-800 pt-2">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">Remaining</p>
                {isAi ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-neutral-950 py-2 text-center">
                      <p className="text-xs uppercase tracking-wide text-neutral-500">Bags</p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">{bagsRemaining != null ? fmtBags(bagsRemaining) : '—'}</p>
                    </div>
                    <div className="rounded-lg bg-neutral-950 py-2 text-center">
                      <p className="text-xs uppercase tracking-wide text-neutral-500">{netLabel}</p>
                      <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">{kilosRemaining != null ? netValueOf(kilosRemaining) : '—'}</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 rounded-lg bg-neutral-950 py-2 text-center">
                    <p className="text-xs uppercase tracking-wide text-neutral-500">Pieces</p>
                    <p className="mt-0.5 text-lg font-bold tabular-nums text-app-text">{piecesRemaining != null ? fmtBags(piecesRemaining) : '—'}</p>
                  </div>
                )}
              </div>
            </div>
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}

export default AuthorityReconciliationPanel
