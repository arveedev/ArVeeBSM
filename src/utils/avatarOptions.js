// Avatar picker option sets — Background (Solid/Gradient) -> Avatar
// (Category -> face) -> Animation, generated/listed here so the exact
// counts agreed with the user stay easy to verify in one place:
// 10 named color palettes x 10 shades each (100 solid swatches, same
// set reused for both ends of a custom gradient) plus one neutral row
// (including pure black and white), and 5 avatar categories x 50 faces
// each (initials always first, not buried at the end).

const SHADE_LIGHTNESS = [85, 75, 65, 58, 52, 46, 40, 34, 26, 18]

export const AVATAR_PALETTES = [
  { name: 'Red', hue: 0 },
  { name: 'Orange', hue: 24 },
  { name: 'Amber', hue: 38 },
  { name: 'Yellow', hue: 50 },
  { name: 'Green', hue: 145 },
  { name: 'Teal', hue: 172 },
  { name: 'Blue', hue: 206 },
  { name: 'Indigo', hue: 243 },
  { name: 'Purple', hue: 272 },
  { name: 'Pink', hue: 328 },
]

const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`

// { paletteName -> [10 hex-ish hsl() strings, lightest to darkest] }
export const AVATAR_SOLID_PALETTE_SWATCHES = Object.fromEntries(
  AVATAR_PALETTES.map((p) => [p.name, SHADE_LIGHTNESS.map((l) => hsl(p.hue, 72, l))])
)

const NEUTRAL_LIGHTNESS = [6, 15, 25, 35, 45, 55, 65, 75, 85, 96]
export const AVATAR_NEUTRAL_SWATCHES = NEUTRAL_LIGHTNESS.map((l) => hsl(0, 0, l))

// Flat list of all 100 solid swatches (10 palettes x 10 shades), for
// callers that just need "is this saved color one of the picker's own
// swatches" without caring which palette it came from.
export const AVATAR_SOLID_COLORS = [
  ...Object.values(AVATAR_SOLID_PALETTE_SWATCHES).flat(),
  ...AVATAR_NEUTRAL_SWATCHES,
]

export const buildGradient = (colorA, colorB) => `linear-gradient(135deg, ${colorA}, ${colorB})`

export const DEFAULT_AVATAR_BG = AVATAR_SOLID_PALETTE_SWATCHES.Blue[3]

// The literal string used for the "plain initials" option - always the
// first entry of every category, never a real emoji.
export const INITIALS_OPTION = null

// 5 categories x 50 faces (INITIALS_OPTION prepended separately by the
// picker, not stored in these arrays, so this list itself always has
// real avatar-face options only).
export const AVATAR_CATEGORIES = {
  Animals: ['🦁', '🦖', '🐘', '🦉', '🐸', '🦊', '🐢', '🐝', '🐼', '🦋', '🐙', '🦄', '🐬', '🦔', '🐿️', '🦩', '🐨', '🦒', '🐳', '🐺', '🐻', '🐯', '🦓', '🦛', '🦏', '🐊', '🦜', '🦚', '🦅', '🦇', '🐴', '🐑', '🐐', '🐇', '🦌', '🦫', '🦦', '🦥', '🐍', '🦎', '🐌', '🦗', '🐞', '🦂', '🐠', '🐡', '🦑', '🦐', '🦀', '🐔'],
  People: ['🧑‍🌾', '👩🏽‍🌾', '👨🏿‍🌾', '👷🏻', '🧑🏾‍💼', '👳🏽', '🧕🏽', '🥷', '🧑🏼‍🚀', '👨🏻‍🔧', '👩🏾‍🔬', '🧑🏻‍🎓', '👨🏽‍🚒', '👩🏿‍✈️', '🧑🏼‍🏭', '🧔🏽', '👱🏻‍♀️', '🧑🏾‍🦱', '👨🏻‍🦳', '🧑🏿‍🦲', '👮🏽', '🕵🏻', '💂🏿', '👩🏼‍⚕️', '👨🏾‍🍳', '🧑🏻‍🏫', '👩🏿‍🎤', '🧑🏼‍🎨', '👨🏽‍⚖️', '🧑🏾‍✈️', '👳🏿‍♂️', '🧕🏻', '🧑🏼‍🦯', '👨🏿‍🦽', '🧙🏻', '🧝🏽', '🧛🏿', '🧟', '🥷🏽', '🤴🏻', '👸🏾', '🧑🏻‍🎄', '🤶🏽', '🎅🏿', '👼🏻', '🦸🏽‍♀️', '🦹🏿‍♂️', '🧚🏻', '🧜🏽‍♀️', '🧞'],
  Farm: ['🌾', '🚜', '🌱', '🐄', '🐖', '🌽', '🪴', '🧺', '🥭', '🛖', '🐓', '🐑', '🌻', '🍚', '🚛', '🏞️', '🪣', '🐂', '🌰', '🐐', '🐎', '🥕', '🥔', '🍅', '🌶️', '🧄', '🧅', '🥬', '🌼', '🌵', '🍇', '🍉', '🍌', '🥥', '🌴', '🚿', '🐕', '🐈', '🥛', '🧀', '🥚', '🐝', '🍯', '🌤️', '🌧️', '☀️', '🌈', '⛅', '🚧', '🏚️'],
  Playful: ['👾', '🤖', '👻', '🎃', '🐲', '🦸', '🥷', '🧙', '🧛', '🎩', '🃏', '🎲', '🎮', '🛸', '⚡', '🔥', '💎', '🌈', '🎭', '🪄', '🎪', '🎨', '🎯', '🎳', '🎰', '🧩', '🪀', '🪁', '🎸', '🥁', '🎷', '🎺', '🎻', '🥋', '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏓', '🏸', '🥊', '🛹', '🛼', '🏆', '🥇', '🧨', '🎆', '🎇'],
  Abstract: ['◆', '●', '▲', '■', '◉', '✦', '◐', '⬢', '✳', '◈', '⬤', '◇', '✶', '⬣', '◍', '✷', '⬡', '◑', '✸', '⬥', '★', '☆', '✪', '✫', '✬', '✭', '✮', '✯', '❂', '❉', '❋', '✤', '✥', '❁', '❃', '❇', '❈', '❊', '❆', '❄', '⌘', '⌥', '⏣', '⏥', '⌬', '⎔', '⎈', '⏦', '◒', '◓'],
}

export const AVATAR_CATEGORY_NAMES = Object.keys(AVATAR_CATEGORIES)

// Maps to the @keyframes defined in index.css (avatar-*). 'none' applies
// no animation at all. Deliberately spread across different axes of
// motion (vertical/diagonal/scale/rotation/horizontal/3D) rather than
// variations on the same small-angle wiggle, so each one is genuinely
// distinguishable at a glance rather than blurring together.
export const AVATAR_ANIMATIONS = [
  { id: 'none', label: 'None' },
  { id: 'bob', label: 'Bob' },
  { id: 'float', label: 'Float' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'spin', label: 'Spin' },
  { id: 'wiggle', label: 'Wiggle' },
  { id: 'shake', label: 'Shake' },
  { id: 'wave', label: 'Wave' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'flip', label: 'Flip' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'sparkle', label: 'Sparkle' },
]

export const DEFAULT_AVATAR = {
  avatarBg: DEFAULT_AVATAR_BG,
  avatarFace: INITIALS_OPTION,
  avatarAnim: 'none',
}
