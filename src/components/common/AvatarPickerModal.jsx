// Avatar Picker — three top-level tabs (Background / Avatar / Animation)
// instead of one long scroll, with a preview pinned above the tabs so it
// never scrolls out of view. Background has its own Solid/Gradient
// sub-tabs; Gradient in turn splits Color 1/Color 2 into their own
// sub-tabs so picking a custom two-color gradient from the full 100-
// swatch palette set doesn't mean scrolling past it twice in a row.
// Portaled to document.body, same fixed-overlay pattern every other
// modal in the app uses (see ConfirmDialog.jsx's own comment for why).

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import Avatar from './Avatar.jsx'
import { primaryButtonClass } from '../forms/shared.js'
import {
  AVATAR_PALETTES,
  AVATAR_SOLID_PALETTE_SWATCHES,
  AVATAR_NEUTRAL_SWATCHES,
  AVATAR_CATEGORIES,
  AVATAR_CATEGORY_NAMES,
  AVATAR_ANIMATIONS,
  DEFAULT_AVATAR,
  INITIALS_OPTION,
  buildGradient,
} from '../../utils/avatarOptions.js'

const TABS = ['Background', 'Avatar', 'Animation']

function SwatchGrid({ onPick, selected }) {
  return (
    <>
      {AVATAR_PALETTES.map((p) => (
        <div key={p.name} className="mb-3">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">{p.name}</p>
          <div className="flex flex-wrap gap-2">
            {AVATAR_SOLID_PALETTE_SWATCHES[p.name].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onPick(c)}
                aria-label={`${p.name} swatch`}
                className={`h-6 w-6 shrink-0 rounded-full transition-transform active:scale-90 ${selected === c ? 'ring-2 ring-app-text ring-offset-2 ring-offset-neutral-900' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      ))}
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Neutral (incl. black &amp; white)</p>
        <div className="flex flex-wrap gap-2">
          {AVATAR_NEUTRAL_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onPick(c)}
              aria-label="Neutral swatch"
              className={`h-6 w-6 shrink-0 rounded-full border border-neutral-700 transition-transform active:scale-90 ${selected === c ? 'ring-2 ring-app-text ring-offset-2 ring-offset-neutral-900' : ''}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
    </>
  )
}

function AvatarPickerModal({ open, current, name, onSave, onClose }) {
  const [avatarBg, setAvatarBg] = useState(current?.avatarBg || DEFAULT_AVATAR.avatarBg)
  const [avatarFace, setAvatarFace] = useState(current?.avatarFace ?? DEFAULT_AVATAR.avatarFace)
  const [avatarAnim, setAvatarAnim] = useState(current?.avatarAnim || DEFAULT_AVATAR.avatarAnim)
  const [activeTab, setActiveTab] = useState('Background')
  const [bgMode, setBgMode] = useState('solid')
  const [colorSlot, setColorSlot] = useState(1)
  const [gradColor1, setGradColor1] = useState(AVATAR_SOLID_PALETTE_SWATCHES.Red[4])
  const [gradColor2, setGradColor2] = useState(AVATAR_SOLID_PALETTE_SWATCHES.Blue[4])
  const [activeCategory, setActiveCategory] = useState(AVATAR_CATEGORY_NAMES[0])
  const [isSaving, setIsSaving] = useState(false)

  if (!open) return null

  const handleSave = async () => {
    setIsSaving(true)
    await onSave({ avatarBg, avatarFace, avatarAnim })
    setIsSaving(false)
    onClose()
  }

  const pickGradColor = (color) => {
    if (colorSlot === 1) setGradColor1(color)
    else setGradColor2(color)
    setAvatarBg(buildGradient(colorSlot === 1 ? color : gradColor1, colorSlot === 1 ? gradColor2 : color))
  }

  const initials = name ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') : '?'

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-sm flex-col rounded-t-2xl border border-neutral-800 bg-neutral-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-base font-semibold text-app-text">Choose Your Avatar</h2>
          {/* Close/delete icons are always red, per house convention. */}
          <button type="button" onClick={onClose} aria-label="Close" className="text-brand-crimson hover:brightness-125">
            <X size={18} />
          </button>
        </div>

        {/* Preview - sits above the tabs so it's always visible
            regardless of which tab is active or how far scrolled. */}
        <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
          <Avatar avatarBg={avatarBg} avatarFace={avatarFace} avatarAnim={avatarAnim} name={name} size={56} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Preview</p>
            <p className="mt-0.5 text-xs text-neutral-500">Stays pinned across every tab.</p>
          </div>
        </div>

        <div className="flex gap-1 px-4 pt-3">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition-colors ${
                activeTab === t ? 'bg-brand-neon text-brand-contrast' : 'text-neutral-400'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {activeTab === 'Background' && (
            <div>
              <div className="mb-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setBgMode('solid')}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${bgMode === 'solid' ? 'bg-brand-neon text-brand-contrast' : 'bg-neutral-950 text-neutral-400'}`}
                >
                  Solid
                </button>
                <button
                  type="button"
                  onClick={() => setBgMode('gradient')}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${bgMode === 'gradient' ? 'bg-brand-neon text-brand-contrast' : 'bg-neutral-950 text-neutral-400'}`}
                >
                  Gradient
                </button>
              </div>

              {bgMode === 'solid' ? (
                <SwatchGrid onPick={setAvatarBg} selected={avatarBg} />
              ) : (
                <>
                  <div className="mb-3 flex items-center gap-2 rounded-lg bg-neutral-950 p-2.5">
                    <div className="h-5 w-5 rounded-full border-2 border-app-text" style={{ background: gradColor1 }} />
                    <span className="text-xs text-neutral-500">+</span>
                    <div className="h-5 w-5 rounded-full border-2 border-app-text" style={{ background: gradColor2 }} />
                    <span className="text-xs text-neutral-500">=</span>
                    <div className="h-6 w-6 rounded-full" style={{ background: buildGradient(gradColor1, gradColor2) }} />
                  </div>
                  <div className="mb-3 flex gap-1">
                    <button
                      type="button"
                      onClick={() => setColorSlot(1)}
                      className={`flex-1 rounded-full py-1.5 text-[11px] font-bold ${colorSlot === 1 ? 'bg-brand-neon text-brand-contrast' : 'bg-neutral-950 text-neutral-400'}`}
                    >
                      Color 1
                    </button>
                    <button
                      type="button"
                      onClick={() => setColorSlot(2)}
                      className={`flex-1 rounded-full py-1.5 text-[11px] font-bold ${colorSlot === 2 ? 'bg-brand-neon text-brand-contrast' : 'bg-neutral-950 text-neutral-400'}`}
                    >
                      Color 2
                    </button>
                  </div>
                  <SwatchGrid onPick={pickGradColor} selected={colorSlot === 1 ? gradColor1 : gradColor2} />
                </>
              )}
            </div>
          )}

          {activeTab === 'Avatar' && (
            <div>
              <div className="mb-3 grid grid-cols-5 gap-2">
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
                {activeCategory} ({AVATAR_CATEGORIES[activeCategory].length + 1})
              </p>
              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setAvatarFace(INITIALS_OPTION)}
                  className={`flex aspect-square items-center justify-center overflow-hidden rounded-full bg-neutral-950 transition-transform active:scale-90 ${
                    avatarFace === INITIALS_OPTION ? 'ring-2 ring-brand-neon' : ''
                  }`}
                >
                  <span className="text-lg font-bold text-neutral-400">{initials}</span>
                </button>
                {AVATAR_CATEGORIES[activeCategory].map((face, i) => (
                  <button
                    key={`${activeCategory}-${i}`}
                    type="button"
                    onClick={() => setAvatarFace(face)}
                    aria-label={face}
                    className={`flex aspect-square items-center justify-center overflow-hidden rounded-full bg-neutral-950 transition-transform active:scale-90 ${
                      avatarFace === face ? 'ring-2 ring-brand-neon' : ''
                    }`}
                  >
                    <span style={{ fontSize: 30, transform: 'scale(1.2)', display: 'inline-block' }}>{face}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'Animation' && (
            <div className="grid grid-cols-4 gap-3 text-center">
              {AVATAR_ANIMATIONS.map(({ id, label }) => (
                <button key={id} type="button" onClick={() => setAvatarAnim(id)} className="transition-transform active:scale-90">
                  <div className={`mx-auto flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-neutral-950 ${avatarAnim === id ? 'ring-2 ring-brand-neon' : ''}`}>
                    <Avatar avatarBg="transparent" avatarFace={avatarFace || '🦊'} avatarAnim={id} size={48} />
                  </div>
                  <p className="mt-1 text-[10px] text-neutral-400">{label}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-neutral-800 p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
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
