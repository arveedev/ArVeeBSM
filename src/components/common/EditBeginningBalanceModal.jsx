// Edit Beginning Balance - a modal wrapper around
// BeginningBalancesPanel.jsx's PileBalanceForm, reached only via
// CreateEditPileModal.jsx's "Edit balance ->" link. On Settings.jsx,
// showing the full BeginningBalancesPanel (with its own complete pile
// list) alongside PileListSection's own list would just duplicate the
// same list twice on one page - reported directly. This modal shows
// exactly one pile's balance form, nothing else, then closes back to
// wherever it was opened from.

import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { PileBalanceForm } from './admin/BeginningBalancesPanel.jsx'

function EditBeginningBalanceModal({ open, pile, warehouseId, onClose }) {
  if (!open || !pile) return null

  return createPortal(
    <div className="fixed inset-0 z-[68] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white"
          >
            <X size={18} />
          </button>
          <PileBalanceForm key={pile.pileId} pile={pile} warehouseId={warehouseId} onDone={onClose} />
        </div>
      </div>
    </div>,
    document.body
  )
}

export default EditBeginningBalanceModal
