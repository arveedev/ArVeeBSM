// Avatar picker option sets — Category -> Avatar -> Animation -> Background,
// generated programmatically (not hand-typed lists of hex codes) so the
// counts agreed with the user (50 solid + 25 gradient backgrounds, 5
// categories of 20 avatars each, 12 animations) stay exact and easy to
// adjust in one place.

// Golden-angle hue stepping (137.5°) spreads N colors evenly around the
// wheel with no two adjacent swatches landing on similar hues, regardless
// of N - the same trick used for the picker's own demo widgets.
const hsl = (i, s, l) => `hsl(${Math.round(i * 137.5) % 360} ${s}% ${l}%)`

export const AVATAR_SOLID_COLORS = Array.from({ length: 50 }, (_, i) => hsl(i, 68, 55))

export const AVATAR_GRADIENTS = Array.from({ length: 25 }, (_, i) => {
  const h1 = Math.round(i * 137.5) % 360
  const h2 = (h1 + 70) % 360
  return `linear-gradient(135deg, ${hsl(i, 75, 55)}, hsl(${h2} 75% 55%))`
})

export const AVATAR_BACKGROUNDS = [...AVATAR_SOLID_COLORS, ...AVATAR_GRADIENTS]

// 5 categories x 20 avatars. Last entry of every category is intentionally
// null - rendered as plain initials, for anyone who'd rather skip pictures.
export const AVATAR_CATEGORIES = {
  Animals: ['🦁', '🦖', '🐘', '🦉', '🐸', '🦊', '🐢', '🐝', '🐼', '🦋', '🐙', '🦄', '🐬', '🦔', '🐿️', '🦩', '🐨', '🦒', '🐳', null],
  People: ['🧑‍🌾', '👩🏽‍🌾', '👨🏿‍🌾', '👷🏻', '🧑🏾‍💼', '👳🏽', '🧕🏽', '🥷', '🧑🏼‍🚀', '👨🏻‍🔧', '👩🏾‍🔬', '🧑🏻‍🎓', '👨🏽‍🚒', '👩🏿‍✈️', '🧑🏼‍🏭', '🧔🏽', '👱🏻‍♀️', '🧑🏾‍🦱', '👨🏻‍🦳', null],
  Farm: ['🌾', '🚜', '🌱', '🐄', '🐖', '🌽', '🪴', '🧺', '🥭', '🛖', '🐓', '🐑', '🌻', '🍚', '🚛', '🏞️', '🪣', '🐂', '🌰', null],
  Playful: ['👾', '🤖', '👻', '🎃', '🐲', '🦸', '🥷', '🧙', '🧛', '🎩', '🃏', '🎲', '🎮', '🛸', '⚡', '🔥', '💎', '🌈', '🎭', null],
  Abstract: ['◆', '●', '▲', '■', '◉', '✦', '◐', '⬢', '✳', '◈', '⬤', '◇', '✶', '⬣', '◍', '✷', '⬡', '◑', '✸', null],
}

export const AVATAR_CATEGORY_NAMES = Object.keys(AVATAR_CATEGORIES)

// Maps to the @keyframes defined in index.css (avatar-*). 'none' applies
// no animation at all.
export const AVATAR_ANIMATIONS = [
  { id: 'none', label: 'None' },
  { id: 'bob', label: 'Bob' },
  { id: 'float', label: 'Float' },
  { id: 'pulse-ring', label: 'Pulse ring' },
  { id: 'sparkle', label: 'Sparkle' },
  { id: 'sway', label: 'Sway' },
  { id: 'nod', label: 'Nod' },
  { id: 'blink', label: 'Blink' },
  { id: 'wiggle', label: 'Wiggle' },
  { id: 'spin-slow', label: 'Spin slow' },
  { id: 'bounce', label: 'Bounce in' },
  { id: 'wave', label: 'Wave' },
]

export const DEFAULT_AVATAR = {
  avatarBg: AVATAR_SOLID_COLORS[0],
  avatarFace: null,
  avatarAnim: 'none',
}
