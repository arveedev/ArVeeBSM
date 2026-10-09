// Marks an element that is scrolling (mouse wheel, touchpad, dragging the bar, keys) with
// data-scrolling for a moment, so the slim scrollbar (see index.css) shows while it is used and
// hides again afterwards. Scroll events do not bubble, so one capturing listener covers every
// scrolling element in the app, including the page itself.

const HIDE_AFTER_MS = 900

export const initScrollReveal = () => {
  if (typeof document === 'undefined' || window.__scrollRevealOn) return
  window.__scrollRevealOn = true
  const timers = new WeakMap()
  document.addEventListener('scroll', (e) => {
    const t = e.target === document ? document.documentElement : e.target
    if (!(t instanceof Element)) return
    t.setAttribute('data-scrolling', '')
    clearTimeout(timers.get(t))
    timers.set(t, setTimeout(() => t.removeAttribute('data-scrolling'), HIDE_AFTER_MS))
  }, true)
}
