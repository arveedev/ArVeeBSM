// Edit Beginning Balance - a modal wrapper around
// BeginningBalancesPanel.jsx's PileBalanceForm, reached only via
// CreateEditPileModal.jsx's "Edit balance ->" link. On Settings.jsx,
// showing the full BeginningBalancesPanel (with its own complete pile
// list) alongside PileListSection's own list would just duplicate the
// same list twice on one page - reported directly. This modal shows
// exactly one pile's balance form, nothing else, then closes back to
// wherever it was opened from.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { PileBalanceForm } from './admin/BeginningBalancesPanel.jsx'

// Must match animate-sheet-slide-down's own duration (index.css).
const CLOSE_ANIMATION_MS = 300

function EditBeginningBalanceModal({ open, pile, warehouseId, onClose }) {
  const [isClosing, setIsClosing] = useState(false)
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      setIsClosing(false)
      onClose()
    }, CLOSE_ANIMATION_MS)
  }

  if (!open || !pile) return null

  return createPortal(
    <div
      className={`fixed inset-0 z-[68] flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4 ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleClose}
    >
      {/* Explicit bg-neutral-900 base - reported real bug: without its
          own solid background this outer wrapper let the darkened
          backdrop (and whatever's behind it) read through at its
          rounded corners, where PileBalanceForm's own inner rounded
          shape doesn't quite reach. */}
      <div
        className={`max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-neutral-900 sm:rounded-2xl ${isClosing ? 'animate-sheet-slide-down' : 'animate-sheet-slide-up'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative">
          {/* Close/delete icons are always red, per house convention. */}
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-brand-crimson"
          >
            <X size={18} />
          </button>
          <PileBalanceForm key={pile.pileId} pile={pile} warehouseId={warehouseId} onDone={handleClose} />
        </div>
      </div>
    </div>,
    document.body
  )
}

export default EditBeginningBalanceModal
