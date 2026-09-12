// Avatar — reusable display for a user's chosen background + face +
// animation (see utils/avatarOptions.js for the option sets). Used in
// AppHeader (beside the page title) and Settings (profile card) so both
// read the exact same saved choice, live, rather than each rolling its
// own rendering.

import { DEFAULT_AVATAR } from '../../utils/avatarOptions.js'

const initialsOf = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

// Sizes the face relative to the circle (matches the picker's own demo
// ratio) and clips it with overflow:hidden so it fills edge-to-edge
// like a real avatar image instead of a small icon floating in empty
// space.
function Avatar({ avatarBg, avatarFace, avatarAnim, name, size = 32, onClick, className = '' }) {
  const bg = avatarBg || DEFAULT_AVATAR.avatarBg
  const face = avatarFace ?? null
  const anim = avatarAnim || 'none'
  const faceSize = Math.round(size * 0.72)
  const initials = initialsOf(name)

  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={onClick ? 'Change avatar' : undefined}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full transition-transform ${onClick ? 'active:scale-90' : ''} ${className}`}
      style={{ width: size, height: size, background: bg }}
    >
      {face ? (
        <span
          className={anim !== 'none' ? `animate-avatar-${anim}` : ''}
          style={{ fontSize: faceSize, lineHeight: 1, display: 'inline-block', '--avatar-scale': 1.2 }}
        >
          {face}
        </span>
      ) : (
        <span className="font-bold text-white/90" style={{ fontSize: Math.round(size * 0.36) }}>
          {initials || '?'}
        </span>
      )}
      {anim === 'sparkle' && (
        <span className="animate-avatar-sparkle-glint pointer-events-none absolute right-0 top-0 text-[0.6em]">✨</span>
      )}
    </Tag>
  )
}

export default Avatar
