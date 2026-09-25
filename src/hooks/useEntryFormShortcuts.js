// Keyboard shortcuts for the entry forms (WSR/WSI, ESR/ESI, WTS) - per
// explicit request. Ctrl/Cmd+S triggers whichever action the visible
// button row currently performs (Save on a new record, Update on an
// existing one) - the same canSave gate/hint the button's own onClick
// already runs, never a silent bypass of validation. Ctrl/Cmd+Shift+
// Backspace opens the Delete confirmation (same as tapping the Delete
// button - never deletes outright), only wired when editing an existing
// record. Shift+Backspace (not plain Ctrl+Backspace) was chosen
// deliberately: browsers/OSes use plain Ctrl+Backspace for "delete the
// previous word" while typing in a text field, and hijacking that would
// silently break normal editing everywhere in these long forms.
//
// Left/Right arrow keys are reserved for stepping to the previous/next
// document in this serial-number series - the on-screen Chevron
// buttons' own keyboard equivalent, per explicit request ("reserve the
// left and right arrow keys for the navigation of the series"). Up/Down
// stay free for their existing job (moving a highlighted suggestion in
// an autocomplete dropdown, or a native <select>'s own default
// behavior) - never claimed here. Left/Right are only intercepted while
// focus ISN'T inside a free-text field (input/textarea/contentEditable),
// so normal text-cursor movement while typing anywhere in the form -
// including the Serial No. field itself when hand-typing a serial - is
// never hijacked; stepping through the series while typing still works
// the same way it always did, via the Chevron buttons themselves.
//
// A single shared hook (not copy-pasted three times) so the three entry
// forms can never drift into having different shortcuts for the same
// action.

import { useEffect } from 'react'

const EDITABLE_INPUT_TYPES = new Set(['text', 'search', 'tel', 'email', 'url', 'password', 'number'])

const isTextEditable = (el) => {
  if (!el) return false
  if (el.isContentEditable) return true
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') return EDITABLE_INPUT_TYPES.has((el.type || 'text').toLowerCase())
  return false
}

export const useEntryFormShortcuts = ({ onSave, onDelete, onStepBack, onStepForward }) => {
  useEffect(() => {
    const handler = (e) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod) {
        const key = e.key.toLowerCase()
        if (key === 's') {
          e.preventDefault()
          onSave?.()
          return
        }
        if (onDelete && e.shiftKey && key === 'backspace') {
          e.preventDefault()
          onDelete()
        }
        return
      }

      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && !e.altKey) {
        if (isTextEditable(document.activeElement)) return
        if (e.key === 'ArrowLeft' && onStepBack) {
          e.preventDefault()
          onStepBack()
        } else if (e.key === 'ArrowRight' && onStepForward) {
          e.preventDefault()
          onStepForward()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSave, onDelete, onStepBack, onStepForward])
}
