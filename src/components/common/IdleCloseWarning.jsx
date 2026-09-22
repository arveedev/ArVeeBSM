// Floating "closing due to inactivity" prompt - paired with
// useIdleCountdown's `secondsLeft`/`resetActivity`. Renders nothing
// until the final warning window starts, per explicit request that an
// entry form give a final warning before auto-closing on a real
// (unsaved) user's input, rather than closing without any notice.
//
// z-[90]: above a full-screen entry form (z-50) so it's actually
// visible while one is open, but below a true blocking dialog like
// ConfirmDialog (z-[105]) - if one of those is open, its own click
// already counts as activity and cancels this anyway.

function IdleCloseWarning({ secondsLeft, onStay, message = 'Closing due to inactivity' }) {
  if (secondsLeft == null) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[90] flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-brand-amber/40 bg-neutral-900 px-4 py-3 shadow-2xl shadow-black/50">
        <span className="text-sm text-app-text">
          {message} in <span className="font-bold tabular-nums text-brand-amber">{secondsLeft}s</span>
        </span>
        <button
          type="button"
          onClick={onStay}
          className="shrink-0 rounded-lg bg-brand-neon px-3 py-1.5 text-xs font-bold text-brand-contrast transition-all active:scale-95"
        >
          Stay
        </button>
      </div>
    </div>
  )
}

export default IdleCloseWarning
