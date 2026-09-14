// Shared animated content for the Save/Update/Delete buttons used
// across StockFormBase, SackFormBase, and WTSForm - kept in one place
// so all three forms' buttons look and behave identically rather than
// three slightly-different one-off implementations.

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Trash2 } from 'lucide-react'

const DUST_ANGLES = [20, 70, 130, 190, 250, 310]

/** Save button - owns its own `<button>` element (unlike Update/Delete's
 * label-only components below) because its idle appearance itself
 * animates: outline (disabled, a required field is blank) <-> filled
 * (enabled, canSave true) plays a one-shot neon pulse-ring on the
 * moment it BECOMES enabled (see save-enable-pulse in index.css) rather
 * than a flat color swap, and tapping it shrinks the whole button down
 * to a small circle with a truly centered spinner inside (fixed - the
 * old check icon was `absolute` with no centering offsets, so it sat
 * off to one side instead of the middle), then a centered check, then
 * expands back - per explicit request and several rounds of demo
 * review. */
export function SaveButton({ onClick, disabled, canSave, isSaving, label = 'Save' }) {
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

  // Only pulses on the FALSE -> TRUE edge (becoming savable) - settling
  // back into disabled is not itself a moment worth marking.
  const [pulseKey, setPulseKey] = useState(0)
  const wasCanSave = useRef(canSave)
  useEffect(() => {
    if (canSave && !wasCanSave.current) setPulseKey((k) => k + 1)
    wasCanSave.current = canSave
  }, [canSave])

  const shrunk = phase !== 'idle'
  const filled = canSave || shrunk

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      key={pulseKey}
      className={`mx-auto flex items-center justify-center text-sm font-semibold transition-all duration-300 ease-out disabled:pointer-events-none ${
        shrunk ? 'h-11 w-11 rounded-full' : 'h-11 w-full rounded-xl'
      } ${
        filled
          ? 'bg-brand-neon text-brand-contrast hover:brightness-110 active:scale-[0.98] disabled:opacity-50'
          : 'border border-brand-neon/40 text-brand-neon/40'
      } ${canSave && !shrunk ? 'animate-save-enable-pulse' : ''}`}
    >
      {shrunk ? (
        phase === 'spinning' ? (
          <Loader2 size={18} className="animate-toast-icon-spin" />
        ) : (
          <Check size={20} strokeWidth={3} className="animate-toast-icon-check" />
        )
      ) : (
        label
      )}
    </button>
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

// Simplified two-part bin (lid + body) instead of lucide's Trash2 -
// needs its own separately-animatable lid group, which a single fixed
// icon component can't give us. Body gives one small downward bounce
// (delete-bin-drop) as the lid shuts (delete-bin-lid) - see index.css's
// own comment: this whole motion, not a checkmark, IS the "it's gone"
// confirmation, per explicit request.
function DeleteBinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <g className="animate-delete-bin-drop">
        <g className="animate-delete-bin-lid" style={{ transformOrigin: '12px 6px' }}>
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </g>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      </g>
    </svg>
  )
}

/** Delete button label - two independent flourishes layered on the same
 * label:
 *  1. A purely cosmetic tap acknowledgment (shake + dust burst) the
 *     instant it's tapped - the real destructive action still waits for
 *     the separate ConfirmDialog. `incrementKey` should be bumped by the
 *     caller's onClick alongside whatever opens that dialog.
 *  2. Once the user actually confirms and the delete is genuinely
 *     in flight (`isSaving` true, same shared flag Save/Update already
 *     use), a spinner plays, then - once it flips back to false, meaning
 *     the delete finished - the bin-lid flourish above (DeleteBinIcon),
 *     never a checkmark: the lid flipping open and shut IS the
 *     confirmation here, per explicit request. The button itself never
 *     shrinks or disappears through any of this - it only leaves the
 *     screen when the form closes afterward. */
export function DeleteButtonLabel({ incrementKey, isSaving, label = 'Delete' }) {
  const [tapPlaying, setTapPlaying] = useState(false)
  const prevKey = useRef(incrementKey)
  useEffect(() => {
    if (incrementKey === prevKey.current) return
    prevKey.current = incrementKey
    setTapPlaying(true)
    const timer = setTimeout(() => setTapPlaying(false), 500)
    return () => clearTimeout(timer)
  }, [incrementKey])

  const [phase, setPhase] = useState('idle') // idle | spinning | bin
  const wasSaving = useRef(false)
  useEffect(() => {
    if (isSaving) {
      setPhase('spinning')
      wasSaving.current = true
      return
    }
    if (wasSaving.current) {
      setPhase('bin')
      const timer = setTimeout(() => setPhase('idle'), 1000)
      wasSaving.current = false
      return () => clearTimeout(timer)
    }
  }, [isSaving])

  const showingIcon = tapPlaying || phase !== 'idle'

  return (
    <span className="relative inline-flex h-5 w-full items-center justify-center">
      <span className={`transition-opacity duration-150 ${showingIcon ? 'opacity-0' : 'opacity-100'}`}>{label}</span>
      {tapPlaying && (
        <span className="pointer-events-none absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
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
      {!tapPlaying && phase !== 'idle' && (
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {phase === 'spinning' ? <Loader2 size={18} className="animate-toast-icon-spin" /> : <DeleteBinIcon />}
        </span>
      )}
    </span>
  )
}
