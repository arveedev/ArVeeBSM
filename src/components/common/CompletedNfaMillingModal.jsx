// Completed NFA Milling Modal — a separate popup (not an inline list
// swap) for browsing Regional Authority Numbers marked complete,
// matching the same pattern CompletedAuthorityModal.jsx/
// CompletedMillingModal.jsx already use: NfaMillingMonitor's own list
// stays pending-only at all times, and "Show Completed" opens this
// instead of replacing it in place. Reuses NfaAllocationRow (exported
// from NfaMillingMonitor.jsx) so the two lists never visually drift
// from each other.

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertTriangle, Search } from 'lucide-react'
import { db } from '../../db/dexie.js'
import { NfaAllocationRow } from './NfaMillingMonitor.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { nfaAllocationMatchesQuery } from '../../utils/monitoringSearch.js'

// Must match the transition duration below.
const CLOSE_ANIMATION_MS = 300
// Must match .animate-row-complete-out's duration in index.css (the
// same exit class NfaAllocationRow applies for isAnimating, in either
// direction - see MillingOrderRow's identical, single-class behavior).
const ROW_EXIT_MS = 700

function CompletedNfaMillingModal({ allocations, recoverySummaryByNumber = new Map(), weightUnit, onClose, isAdmin = false }) {
  // Delays the actual onClose call until the exit animation has time
  // to play, same rule as CompletedMillingModal.jsx - every entrance
  // needs a matching exit rather than an instant, jarring unmount.
  const [isClosing, setIsClosing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedNumber, setExpandedNumber] = useState(null)
  const scrollRef = useRef(null)

  // Same body-scroll lock every other full-screen modal already has.
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  // Same "keep matching rows in view while typing" behavior as every
  // other Completed modal in this app.
  useEffect(() => {
    if (searchQuery.trim()) scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [searchQuery])

  const handleClose = () => {
    setIsClosing(true)
    setTimeout(onClose, CLOSE_ANIMATION_MS)
  }

  // Allocation currently awaiting confirmation to be sent back to
  // pending, or null when no confirmation is showing.
  const [pendingUncomplete, setPendingUncomplete] = useState(null)
  // regionalAuthorityNumber currently playing its "sent back to
  // pending" glow+collapse exit animation - mirrors
  // CompletedMillingModal.jsx's exact pattern (delayed DB write, red
  // glow instead of green).
  const [revertingNumber, setRevertingNumber] = useState(null)

  useEffect(() => {
    if (!revertingNumber) return
    const stillHere = allocations.some((a) => a.regionalAuthorityNumber === revertingNumber)
    if (!stillHere) setRevertingNumber(null)
  }, [allocations, revertingNumber])

  const requestUncomplete = (allocation, e) => {
    e.stopPropagation()
    setPendingUncomplete(allocation)
  }
  const confirmUncomplete = () => {
    if (!pendingUncomplete) return
    const allocation = pendingUncomplete
    setPendingUncomplete(null)
    setRevertingNumber(allocation.regionalAuthorityNumber)
    setTimeout(() => {
      db.ricemillAllocations.update(allocation.regionalAuthorityNumber, {
        manuallyCompleted: false,
        completedAt: null,
        completedBy: null,
      })
    }, ROW_EXIT_MS)
  }

  const matchesQuery = (a) =>
    nfaAllocationMatchesQuery(a.regionalAuthorityNumber, recoverySummaryByNumber.get(a.regionalAuthorityNumber)?.transferEntries, searchQuery)

  // Portaled straight to document.body - same reasoning as
  // CompletedMillingModal.jsx: this component is opened from deep
  // inside NfaMillingMonitor, which on Home.jsx/AdminMonitoring.jsx can
  // sit under an animated ancestor whose lingering transform would
  // otherwise trap a `position: fixed` child inside it instead of the
  // real viewport.
  return createPortal(
    <div className={`fixed inset-0 z-50 flex flex-col bg-neutral-950 ${isClosing ? 'animate-sheet-slide-down' : 'animate-sheet-slide-up'}`}>
      <div className="border-b border-neutral-800 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-app-text">Completed NFA Milling</h1>
            <p className="mt-0.5 text-xs text-neutral-500">Tap an entry to see its usage breakdown.</p>
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
        {allocations.length > 0 && (
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
        {allocations.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">No completed NFA allocations.</p>
        ) : (
          <>
            {allocations.every((a) => !matchesQuery(a)) && (
              <p className="py-2 text-center text-xs text-neutral-500">No completed Regional Authority Numbers match that search.</p>
            )}
            <ul className="[contain:layout]">
              {allocations.map((a) => {
                const recovery = recoverySummaryByNumber.get(a.regionalAuthorityNumber)
                const used = recovery?.issuedKilos ?? 0
                const isExpanded = expandedNumber === a.regionalAuthorityNumber
                return (
                  <NfaAllocationRow
                    key={a.regionalAuthorityNumber}
                    allocation={a}
                    recovery={recovery}
                    used={used}
                    weightUnit={weightUnit}
                    isExpanded={isExpanded}
                    onToggleExpand={() => setExpandedNumber(isExpanded ? null : a.regionalAuthorityNumber)}
                    isAdmin={isAdmin}
                    isAnimating={revertingNumber === a.regionalAuthorityNumber}
                    onToggleComplete={requestUncomplete}
                    matches={matchesQuery(a)}
                  />
                )
              })}
            </ul>
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingUncomplete)}
        title="Mark this allocation as pending again?"
        description={pendingUncomplete ? `${pendingUncomplete.regionalAuthorityNumber} will move back to the pending list.` : undefined}
        confirmLabel="Mark as Pending"
        icon={AlertTriangle}
        onConfirm={confirmUncomplete}
        onCancel={() => setPendingUncomplete(null)}
      />
    </div>,
    document.body
  )
}

export default CompletedNfaMillingModal
