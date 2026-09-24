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
// A single shared hook (not copy-pasted three times) so the three entry
// forms can never drift into having different shortcuts for the same
// action.

import { useEffect } from 'react'

export const useEntryFormShortcuts = ({ onSave, onDelete }) => {
  useEffect(() => {
    const handler = (e) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
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
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSave, onDelete])
}
