// Avatar Picker — Category -> Avatar -> Animation -> Background, exactly
// the flow agreed on with the user (in that order), with a live preview
// that updates as each choice is tapped. Portaled to document.body, same
// fixed-overlay pattern every other modal in the app uses (see
// ConfirmDialog.jsx's own comment for why - a plain `fixed` element gets
// constrained to a transformed ancestor otherwise).

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import Avatar from './Avatar.jsx'
import { primaryButtonClass } from '../forms/shared.js'
import {
  AVATAR_SOLID_COLORS,
  AVATAR_GRADIENTS,
  AVATAR_CATEGORIES,
  AVATAR_CATEGORY_NAMES,
  AVATAR_ANIMATIONS,
  DEFAULT_AVATAR,
} from '../../utils/avatarOptions.js'

function AvatarPickerModal({ open, current, name, onSave, onClose }) {
  const [avatarBg, setAvatarBg] = useState(current?.avatarBg || DEFAULT_AVATAR.avatarBg)
  const [avatarFace, setAvatarFace] = useState(current?.avatarFace ?? DEFAULT_AVATAR.avatarFace)
  const [avatarAnim, setAvatarAnim] = useState(current?.avatarAnim || DEFAULT_AVATAR.avatarAnim)
  const [activeCategory, setActiveCategory] = useState(AVATAR_CATEGORY_NAMES[0])
  const [isSaving, setIsSaving] = useState(false)

  if (!open) return null

  const handleSave = async () => {
    setIsSaving(true)
    await onSave({ avatarBg, avatarFace, avatarAnim })
    setIsSaving(false)
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-t-2xl border border-neutral-800 bg-neutral-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-base font-semibold text-app-text">Choose Your Avatar</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-neutral-400 hover:text-app-text">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-5 flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
            <Avatar avatarBg={avatarBg} avatarFace={avatarFace} avatarAnim={avatarAnim} name={name} size={72} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Preview</p>
              <p className="mt-0.5 text-xs text-neutral-500">Updates as you tap below.</p>
            </div>
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Background — solid</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {AVATAR_SOLID_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setAvatarBg(c)}
                aria-label={`Background ${c}`}
                className={`h-7 w-7 shrink-0 rounded-full transition-transform active:scale-90 ${avatarBg === c ? 'ring-2 ring-app-text ring-offset-2 ring-offset-neutral-900' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Background — gradient</p>
          <div className="mb-5 flex flex-wrap gap-2">
            {AVATAR_GRADIENTS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setAvatarBg(g)}
                aria-label="Gradient background"
                className={`h-7 w-7 shrink-0 rounded-full transition-transform active:scale-90 ${avatarBg === g ? 'ring-2 ring-app-text ring-offset-2 ring-offset-neutral-900' : ''}`}
                style={{ background: g }}
              />
            ))}
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Category</p>
          <div className="mb-4 grid grid-cols-5 gap-2">
            {AVATAR_CATEGORY_NAMES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`rounded-lg border px-1 py-2 text-center transition-colors ${
                  activeCategory === cat ? 'border-brand-neon bg-brand-neon/10' : 'border-transparent bg-neutral-950'
                }`}
              >
                <span className="text-base">{AVATAR_CATEGORIES[cat][0]}</span>
                <p className={`mt-0.5 text-[9px] ${activeCategory === cat ? 'text-brand-neon' : 'text-neutral-500'}`}>{cat}</p>
              </button>
            ))}
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Avatar — {activeCategory} ({AVATAR_CATEGORIES[activeCategory].length})
          </p>
          <div className="mb-5 grid grid-cols-5 gap-2">
            {AVATAR_CATEGORIES[activeCategory].map((face, i) => (
              <button
                key={`${activeCategory}-${i}`}
                type="button"
                onClick={() => setAvatarFace(face)}
                aria-label={face ?? 'Initials'}
                className={`flex aspect-square items-center justify-center overflow-hidden rounded-full bg-neutral-950 transition-transform active:scale-90 ${
                  avatarFace === face ? 'ring-2 ring-brand-neon' : ''
                }`}
              >
                {face ? (
                  <span style={{ fontSize: 22, transform: 'scale(1.2)', display: 'inline-block' }}>{face}</span>
                ) : (
                  <span className="text-xs font-bold text-neutral-400">{name ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') : '?'}</span>
                )}
              </button>
            ))}
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Animation</p>
          <div className="flex flex-wrap gap-2">
            {AVATAR_ANIMATIONS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setAvatarAnim(id)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  avatarAnim === id ? 'bg-brand-neon text-brand-contrast' : 'bg-neutral-950 text-neutral-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-neutral-800 p-4">
          <button type="button" onClick={handleSave} disabled={isSaving} className={`w-full ${primaryButtonClass}`}>
            {isSaving ? 'Saving…' : 'Save Avatar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default AvatarPickerModal
