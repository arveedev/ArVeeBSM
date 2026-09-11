// Wraps one row of a searchable list so it shrinks away (collapses height,
// fades, scales down slightly) instead of just vanishing when it stops
// matching the current search text, and grows back in when it matches
// again - live, on every keystroke. Requires the row to stay MOUNTED
// (rendered with `matches` toggling, not removed from the array by
// .filter() before rendering) - the animation only plays because the row
// is still there transitioning, not being unmounted/remounted.
//
// The grid-template-rows 0fr/1fr trick (rather than height: 0/auto,
// which can't be transitioned) is what makes collapsing to a genuinely
// auto-sized 0 work without measuring the row's height in JS first.

// `as` picks the outer element - default 'div', or 'li' when the row
// sits directly inside a <ul>/<ol> (HTML doesn't allow a <div> wrapper
// between a list and its <li> children - some browsers silently hoist a
// misplaced <li> back out to the list during parsing, which would break
// this animation entirely).
//
// `gapClass` is a Tailwind margin-top class (e.g. 'mt-2') applied ONLY
// while the row matches. This exists because the parent list can't use
// Tailwind's own `space-y-*` (which adds a fixed margin-top to every
// sibling regardless of state) - a collapsed row's own CONTENT correctly
// shrinks to ~0px, but `space-y-*`'s margin still applied in full,
// leaving a real, visible gap of empty space between collapsed rows.
// With several rows collapsed at once (the common case while typing a
// search), those gaps stacked into a "scattered, full of weird spaces"
// look instead of the surviving rows sitting flush together - a real,
// reported bug. Giving each row its OWN conditional margin instead (and
// removing space-y-* from the parent <ul>/<ol> entirely) makes a
// collapsed row's total footprint (content + margin) genuinely zero.
export default function ShrinkFilterRow({ matches, children, className = '', as: As = 'div', gapClass = 'mt-2' }) {
  return (
    <As
      className={`grid transition-[grid-template-rows,margin-top] duration-300 ease-out ${matches ? `grid-rows-[1fr] ${gapClass}` : 'grid-rows-[0fr] mt-0'} ${className}`}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={`origin-top transition-[opacity,transform] duration-300 ease-out ${matches ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        >
          {children}
        </div>
      </div>
    </As>
  )
}
