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
export default function ShrinkFilterRow({ matches, children, className = '', as: As = 'div' }) {
  return (
    <As
      className={`grid transition-[grid-template-rows] duration-300 ease-out ${matches ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'} ${className}`}
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
