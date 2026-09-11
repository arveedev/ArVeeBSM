// Completed Milling/Test Milling Modal — a separate popup (not an
// inline list swap) for browsing completed MO/TMO operations, matching
// the same pattern CompletedAuthorityModal.jsx already uses for the
// AI/SIA Monitor: MillingMonitor's own list stays pending-only at all
// times, and "Show Completed" opens this instead of replacing it in
// place. Reuses MillingOrderRow (exported from MillingMonitor.jsx) so
// the two lists never visually drift from each other.

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertTriangle, Search } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { markMillingOrderDone } from '../../services/googleSheetsBridge.js'
import { MillingOrderRow } from './MillingMonitor.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { millingOrderMatchesQuery } from '../../utils/monitoringSearch.js'

// Must match the transition duration below.
const CLOSE_ANIMATION_MS = 300

function CompletedMillingModal({ orders, authorities = [], warehouseMap = new Map(), type, onSelectOrder, onClose, isAdmin = false }) {
  // Delays the actual onClose call until the exit animation has time
  // to play, same rule as CompletedAuthorityModal.jsx - every entrance
  // needs a matching exit rather than an instant, jarring unmount.
  const [isClosing, setIsClosing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const scrollRef = useRef(null)
  // Reported: searching while scrolled down the list never brought the
  // matching rows into view. Scrolls this modal's own scrollable area
  // back to the top the moment a search actually STARTS (empty ->
  // non-empty), not on every further keystroke.
  const wasSearchEmptyRef = useRef(true)
  useEffect(() => {
    const isEmpty = !searchQuery.trim()
    if (!isEmpty && wasSearchEmptyRef.current) {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
    wasSearchEmptyRef.current = isEmpty
  }, [searchQuery])

  // Same authority join MillingMonitor.jsx's own pending list uses -
  // db.millingOrders has no customerName/orNumber/remarks of its own,
  // only via the AI/SIA it links to (see monitoringSearch.js).
  const authorityByOrderId = new Map(
    orders.map((o) => [
      o.orderId,
      authorities.find((a) => (o.aiNumber && a.aiNumber === o.aiNumber) || (o.siaNumber && a.siaNumber === o.siaNumber)) ?? null,
    ])
  )
  const matchesQuery = (o) => millingOrderMatchesQuery(o, searchQuery, authorityByOrderId.get(o.orderId), warehouseMap)
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(onClose, CLOSE_ANIMATION_MS)
  }

  // Order currently awaiting confirmation to be sent back to pending,
  // or null when no confirmation is showing.
  const [pendingUncomplete, setPendingUncomplete] = useState(null)
  // orderId currently playing its "sent back to pending" glow+collapse
  // exit animation - mirrors CompletedAuthorityModal.jsx's exact
  // pattern (delayed DB write, red glow instead of green).
  const [revertingId, setRevertingId] = useState(null)
  // Must match .animate-row-revert-out's duration in index.css.
  const ROW_EXIT_MS = 700

  useEffect(() => {
    if (!revertingId) return
    const stillHere = orders.some((o) => o.orderId === revertingId)
    if (!stillHere) setRevertingId(null)
  }, [orders, revertingId])

  // Only ever offered for orders completed by the MANUAL checkbox.
  //
  // Deliberately NOT also excluding o.fulfilled here (a previous
  // version did, on the theory that a genuinely-fulfilled order isn't
  // "done by mistake"). That assumed o.fulfilled is a trustworthy
  // "actually done" signal, the same way it is for AI/SIA Authorities
  // - but per explicit request, MO/TMO completion is manual-only now,
  // specifically because o.fulfilled's kg/piece math only ever tracks
  // primary stock, never By Products (entered too inconsistently for
  // the app to verify) - it's advisory (see needsConfirmation in
  // MillingMonitor.jsx's amber-border cue), never authoritative. It
  // no longer drives list membership either (see isOrderCompleted in
  // MillingMonitor.jsx), so trusting it here to BLOCK an admin's own
  // uncheck would be inconsistent with not trusting it to complete the
  // order in the first place.
  //
  // Deliberately NOT also excluding o.sheetStatus === 'DONE' here (a
  // previous version did) - marking an order complete via this same
  // checkbox writes 'DONE' back to the Sheet's STATUS column
  // (markMillingOrderDone, see toggleManualComplete in
  // MillingMonitor.jsx), so after the next sync pulls that same write
  // back in, sheetStatus reads 'DONE' for every order the admin JUST
  // manually completed through the app - which silently made the
  // uncheck control disappear the moment it was used, locking out the
  // very feature it gates. manuallyCompleted is already the correct,
  // app-authoritative signal for "this was done via the app's own
  // checkbox" - no need to also trust sheetStatus, which can no longer
  // reliably distinguish "typed DONE directly on the Sheet" from "the
  // app wrote DONE because the admin already completed it here."
  const canUncomplete = (o) => isAdmin && o.manuallyCompleted

  const requestUncomplete = (order, e) => {
    e.stopPropagation()
    setPendingUncomplete(order)
  }
  const confirmUncomplete = () => {
    if (!pendingUncomplete) return
    const order = pendingUncomplete
    setPendingUncomplete(null)
    setRevertingId(order.orderId)
    setTimeout(() => {
      db.millingOrders.update(order.orderId, { manuallyCompleted: false })
      // Best-effort, fire-and-forget - clears the Sheet's STATUS cell
      // back to blank so it doesn't keep showing DONE there after
      // being reverted to pending in the app.
      markMillingOrderDone(order.type, order.number, '')
    }, ROW_EXIT_MS)
  }

  const label = type === 'MO' ? 'Milling' : 'Test Milling'

  // Portaled straight to document.body - this component is opened from
  // deep inside MillingMonitor, which on Home.jsx is nested under a
  // `.stagger-fields`/`.animate-flow-down` ancestor. Those animations
  // use `animation-fill-mode: both`, so even after the animation ends
  // the element keeps a non-`none` `transform` value applied (e.g.
  // `translateY(0px)`) - and any non-`none` transform on an ancestor
  // becomes the containing block for `position: fixed` descendants
  // instead of the real viewport. Without the portal, this modal
  // rendered "fixed" only relative to that ancestor's own box, which
  // is what caused it to appear trapped inside the scrolling list
  // instead of covering the screen.
  return createPortal(
    <div className={`fixed inset-0 z-50 flex flex-col bg-neutral-950 ${isClosing ? 'animate-sheet-slide-down' : 'animate-sheet-slide-up'}`}>
      <div className="border-b border-neutral-800 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-app-text">Completed {label}</h1>
            <p className="mt-0.5 text-xs text-neutral-500">Tap an entry to see its full transaction history.</p>
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
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {orders.length > 0 && (
          <div className="relative mb-3">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="w-full rounded-xl border border-neutral-800 bg-neutral-900 py-2 pl-9 pr-9 text-sm text-app-text outline-none focus:border-brand-neon"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-neutral-500 transition-colors hover:text-app-text"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
        {orders.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">
            No completed {type} operations.
          </p>
        ) : (
          <>
            {orders.every((o) => !matchesQuery(o)) && (
              <p className="py-2 text-center text-xs text-neutral-500">No completed {type} operations match that search.</p>
            )}
          <ul>
            {orders.map((o) => (
              <MillingOrderRow
                key={o.orderId}
                order={o}
                onSelect={onSelectOrder}
                isAdmin={canUncomplete(o)}
                isAnimating={revertingId === o.orderId}
                onToggleComplete={requestUncomplete}
                matches={matchesQuery(o)}
              />
            ))}
          </ul>
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingUncomplete)}
        title="Mark this order as pending again?"
        description={pendingUncomplete ? `${pendingUncomplete.number} will move back to the Pending list.` : undefined}
        confirmLabel="Mark as Pending"
        icon={AlertTriangle}
        onConfirm={confirmUncomplete}
        onCancel={() => setPendingUncomplete(null)}
      />
    </div>,
    document.body
  )
}

export default CompletedMillingModal
