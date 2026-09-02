// Confirmation dialog — used wherever an action needs confirmation.
// Browser-native confirm() is banned per Section 2.3, so this renders a
// small centered modal. Defaults to "Delete" (the strict-uniform label
// for destructive actions per the PRD), but confirmLabel can override it
// for non-destructive confirmations like logout, where "Delete" would be
// semantically wrong.
//
// An optional `icon` (e.g. a lucide AlertTriangle) marks a confirmation
// as warning-style - besides showing the icon, it also gives the modal
// box itself a fast, smooth entrance transition (scale + fade) and the
// exact reverse on close/cancel, rather than the instant show/hide used
// for regular confirmations elsewhere. Opt-in per usage via the icon
// prop, so every existing delete confirmation in the app is completely
// unaffected unless it explicitly asks for this treatment.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Must match the transition duration used on the box below.
const BOX_ANIMATION_MS = 220

function ConfirmDialog({ open, title = 'Delete this item?', description, confirmLabel = 'Delete', cancelLabel = 'Cancel', onConfirm, onCancel, icon: Icon, rotate = false, children, confirmDisabled = false }) {
  const [shouldRender, setShouldRender] = useState(open)
  const [hasEntered, setHasEntered] = useState(false)

  // Only warning-style (icon present) confirmations get the animated
  // box - regular ones keep the simple, instant show/hide they always
  // had.
  const isAnimated = Boolean(Icon)

  useEffect(() => {
    if (!isAnimated) return
    if (open) {
      setShouldRender(true)
    } else {
      setHasEntered(false)
      const timer = setTimeout(() => setShouldRender(false), BOX_ANIMATION_MS)
      return () => clearTimeout(timer)
    }
  }, [open, isAnimated])

  useEffect(() => {
    if (!isAnimated || !shouldRender || !open) return
    const frame = requestAnimationFrame(() => setHasEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [isAnimated, shouldRender, open])

  if (isAnimated ? !shouldRender : !open) return null

  // Portaled straight to document.body - a plain `fixed` element gets
  // constrained to the nearest ancestor with its own transform/filter/
  // perspective (that ancestor becomes its containing block) instead of
  // the real viewport. Piles.jsx's full-screen pile layout applies a
  // rotate() transform to simulate landscape mode, which made this
  // dialog render broken/invisible when opened from there since it
  // wasn't a portal - it inherited that ancestor's rotated, resized box
  // as its "fixed" reference frame instead of the actual screen.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      {/* rotate - for callers (Piles.jsx's full-screen pile layout) that
          simulate landscape via a rotated container on a physically
          portrait device: this dialog is centered via flex, so rotating
          it around its own center matches the surrounding rotated
          content without needing any position compensation. Composed
          into the same transform as the scale entrance animation
          (isAnimated) rather than a separate wrapping element, which
          would have needed its own width to keep w-full meaningful. */}
      <div
        style={{
          transform: [
            isAnimated ? (hasEntered ? 'scale(1)' : 'scale(0.85)') : null,
            rotate ? 'rotate(90deg)' : null,
          ].filter(Boolean).join(' ') || undefined,
          opacity: isAnimated ? (hasEntered ? 1 : 0) : undefined,
          transition: isAnimated ? `transform ${BOX_ANIMATION_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity ${BOX_ANIMATION_MS}ms ease-out` : undefined,
        }}
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {Icon && (
          <div className="mb-3 flex justify-center">
            <div className="rounded-full bg-brand-amber/15 p-3 text-brand-amber">
              <Icon size={28} />
            </div>
          </div>
        )}
        <h2 className="text-base font-semibold text-app-text text-center">{title}</h2>
        {description && <p className="mt-2 text-sm text-neutral-400 text-center">{description}</p>}
        {children && <div className="mt-3">{children}</div>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-3 text-sm font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-95"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="flex-1 rounded-xl bg-brand-crimson px-3 py-3 text-sm font-semibold text-app-text transition-all hover:brightness-110 hover:shadow-[0_0_16px_rgba(239,68,68,0.45)] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default ConfirmDialog
