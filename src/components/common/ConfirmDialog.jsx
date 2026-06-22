// Confirmation dialog — used wherever a destructive action (Delete) needs
// confirmation. Browser-native confirm() is banned per Section 2.3, so this
// renders a small centered modal with strict-uniform "Delete" / "Cancel"
// labels.

function ConfirmDialog({ open, title = 'Delete this item?', description, onConfirm, onCancel }) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {description && <p className="mt-2 text-sm text-neutral-400">{description}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-white active:scale-95"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-brand-crimson px-3 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 hover:shadow-[0_0_16px_rgba(239,68,68,0.45)] active:scale-95"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
