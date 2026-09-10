// Concept F (picked) - a button that morphs through a spinner into a
// checkmark on its own, in place, instead of just re-enabling with no
// visible confirmation once an async action finishes. Reuses
// animate-toast-icon-check (the same spring checkmark pop already used
// by every success toast) rather than inventing a second checkmark
// animation.
//
// Drop-in for any admin panel's plain Save button: pass the same sync/
// async onClick it already has; this handles the busy/done states and
// re-throws so an existing try/catch around the call site (if any)
// still sees real errors.

import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

const DONE_HOLD_MS = 1300

const MorphButton = ({ label, doneLabel = 'Saved', onClick, className = '', disabled = false }) => {
  const [state, setState] = useState('idle') // idle | busy | done

  const handleClick = async () => {
    if (state === 'busy' || disabled) return
    setState('busy')
    try {
      // onClick returning `false` (not just undefined) means "handled,
      // but nothing actually happened" - a validation failure that
      // already showed its own toast.error, not a real save. Skips the
      // checkmark morph silently instead of showing "Saved" on a save
      // that never happened.
      const result = await onClick()
      if (result === false) {
        setState('idle')
        return
      }
      setState('done')
      setTimeout(() => setState('idle'), DONE_HOLD_MS)
    } catch (err) {
      setState('idle')
      throw err
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || state === 'busy'}
      className={`flex items-center justify-center gap-2 ${className}`}
    >
      {state === 'busy' && (
        <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin" />
      )}
      {state === 'done' && <CheckCircle2 size={16} className="shrink-0 animate-toast-icon-check" />}
      <span>{state === 'done' ? doneLabel : label}</span>
    </button>
  )
}

export default MorphButton
