// Shared animated content for the Save/Update/Delete buttons used
// across StockFormBase, SackFormBase, and WTSForm - kept in one place
// so all three forms' buttons look and behave identically rather than
// three slightly-different one-off implementations.

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Trash2 } from 'lucide-react'

const DUST_ANGLES = [20, 70, 130, 190, 250, 310]

/** Save button label - the text morphs into a checkmark the moment
 * isSaving flips from true back to false (the save actually finished),
 * holds briefly, then morphs back. Not triggered on click itself -
 * clicking only sets isSaving true, which starts the button's own
 * disabled state; this reacts to the save completing. */
export function SaveButtonLabel({ isSaving, label = 'Save' }) {
  const [showCheck, setShowCheck] = useState(false)
  const wasSaving = useRef(false)
  useEffect(() => {
    if (wasSaving.current && !isSaving) {
      setShowCheck(true)
      const timer = setTimeout(() => setShowCheck(false), 1100)
      wasSaving.current = isSaving
      return () => clearTimeout(timer)
    }
    wasSaving.current = isSaving
  }, [isSaving])

  return (
    <span className="relative inline-flex h-5 w-full items-center justify-center">
      <span className={`transition-all duration-150 ${showCheck ? 'scale-75 opacity-0' : 'scale-100 opacity-100'}`}>
        {label}
      </span>
      <Check
        size={20}
        strokeWidth={3}
        className={`absolute transition-opacity duration-150 ${showCheck ? 'opacity-100 animate-toast-icon-check' : 'opacity-0'}`}
      />
    </span>
  )
}

/** Update button content - label and icon share one phase state so the
 * label only ever reappears once the icon animation (spin, then a
 * checkmark hold) has fully finished, not the instant isSaving flips
 * back to false - splitting these into two independently-driven pieces
 * first caused the label to pop back in while the checkmark was still
 * showing. The icon is absolutely centered independent of the label's
 * own layout, so it stays centered regardless of the label's width (a
 * real bug from an earlier flex-row version where the icon sat off to
 * one side next to an invisible-but-still-space-occupying label). Label
 * text itself never changes - it always just reads "Update". */
export function UpdateButtonContent({ isSaving, label = 'Update' }) {
  const [phase, setPhase] = useState('idle') // idle | spinning | check
  const wasSaving = useRef(false)
  useEffect(() => {
    if (isSaving) {
      setPhase('spinning')
      wasSaving.current = true
      return
    }
    if (wasSaving.current) {
      setPhase('check')
      const timer = setTimeout(() => setPhase('idle'), 900)
      wasSaving.current = false
      return () => clearTimeout(timer)
    }
  }, [isSaving])

  return (
    <span className="relative inline-flex h-5 w-full items-center justify-center">
      <span className={phase === 'idle' ? 'opacity-100' : 'opacity-0'}>{label}</span>
      {phase !== 'idle' && (
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {phase === 'spinning' ? (
            <Loader2 size={18} className="animate-toast-icon-spin" />
          ) : (
            <Check size={18} strokeWidth={3} className="animate-toast-icon-check" />
          )}
        </span>
      )}
    </span>
  )
}

/** Delete button label - a purely cosmetic flourish on tap (the real
 * destructive action still waits for the separate ConfirmDialog, this
 * only acknowledges the tap): the label swaps for a shaking trash icon
 * with a small dust-particle burst, then reverts. incrementKey should
 * be bumped by the caller's onClick alongside whatever opens the
 * confirm dialog. */
export function DeleteButtonLabel({ incrementKey, label = 'Delete' }) {
  const [playing, setPlaying] = useState(false)
  // Compares against the previous VALUE rather than a "have we run
  // yet" boolean latch - the same class of bug just fixed in
  // Settings.jsx: a boolean flipped unconditionally inside the "skip"
  // branch gets flipped by the first of React StrictMode's two
  // synthetic mount invocations, so the second invocation sees it
  // already flipped and plays the animation anyway, on every mount
  // (which is why this was firing on entrance, not just on tap). A
  // value comparison is safe because both of StrictMode's invocations
  // see the exact same incrementKey/prevKey pair and take the same
  // branch, deterministically.
  const prevKey = useRef(incrementKey)
  useEffect(() => {
    if (incrementKey === prevKey.current) return
    prevKey.current = incrementKey
    setPlaying(true)
    const timer = setTimeout(() => setPlaying(false), 500)
    return () => clearTimeout(timer)
  }, [incrementKey])

  return (
    <span className="relative inline-flex h-5 w-full items-center justify-center">
      <span className={`transition-opacity duration-150 ${playing ? 'opacity-0' : 'opacity-100'}`}>{label}</span>
      {playing && (
        <span className="absolute inline-flex items-center justify-center">
          <Trash2 size={18} className="animate-toast-icon-shake" />
          {DUST_ANGLES.map((angle, i) => (
            <span
              key={i}
              className="absolute h-1 w-1 rounded-full bg-current animate-delete-dust"
              style={{
                '--dust-x': `${Math.cos((angle * Math.PI) / 180) * 22}px`,
                '--dust-y': `${Math.sin((angle * Math.PI) / 180) * 22 - 6}px`,
              }}
            />
          ))}
        </span>
      )}
    </span>
  )
}
