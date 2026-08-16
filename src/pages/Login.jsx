// Login — custom 6-digit PIN keypad. Implements Step 3.1.
//
// A visually-hidden type="number" input handles physical-keyboard /
// native-keypad entry (per Section 2.3), while the on-screen grid is the
// primary touch interface. Both paths feed the same `pin` string state so
// leading zeros in access codes are preserved.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext.jsx'
import { APP_VERSION } from '../version.js'

const PIN_LENGTH = 6
const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

// Buttons fly outward first (FLY_MS), THEN the whole screen fades
// (FADE_MS) - sequenced rather than simultaneous, so it reads as
// "buttons fly outward, then the display fades" rather than everything
// happening at once. Navigation waits for both phases to finish.
const FLY_MS = 1400
const ANIMATION_MS = FLY_MS

/**
 * Computes an outward "fly" transform for a keypad button based on its
 * position in the 3-column grid - buttons radiate away from the grid's
 * own center in whichever direction they already sit, like a door/
 * portal opening outward, rather than every button moving the same way.
 * Uses viewport-relative distances (vw/vh) so buttons clearly fly off
 * screen regardless of the keypad's exact on-screen size/position,
 * rather than a fixed pixel offset that could look "off" if the actual
 * layout doesn't match assumed dimensions.
 */
const flyTransform = (index, columns = 3, rows = 4) => {
  const col = index % columns
  const row = Math.floor(index / columns)
  const dx = (col - (columns - 1) / 2) * 30
  const dy = (row - (rows - 1) / 2) * 18
  return { transform: `translate(${dx}vw, ${dy}vh) scale(0.5)`, opacity: 0 }
}

/**
 * Horizontal-only outward fly for the PIN dots row - they sit in a
 * single row, so only left/right movement (no vertical) makes sense.
 */
const flyTransformHorizontal = (index, count = PIN_LENGTH) => {
  const dx = (index - (count - 1) / 2) * 20
  return { transform: `translateX(${dx}vw) scale(0.5)`, opacity: 0 }
}

/** Simple upward fly-and-fade for the title/subtitle, which sit above
 * the keypad and shouldn't just sit still while everything below them
 * flies apart. */
const flyTransformUp = { transform: 'translateY(-15vh) scale(0.9)', opacity: 0 }

function Login() {
  const [pin, setPin] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isExiting, setIsExiting] = useState(false)
  const [hasEntered, setHasEntered] = useState(false)
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const { user, login } = useAuth()

  // Entrance animation - the reverse of the exit: everything starts in
  // its flown-out position (same transforms used on exit) and animates
  // inward to its normal spot right after mount. Needs a tick of delay
  // (requestAnimationFrame) so the browser actually paints the
  // flown-out starting state first, before the transition to the
  // normal position is applied - otherwise both states could land in
  // the same paint and the transition wouldn't visibly animate at all.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setHasEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Lock body scroll during any fly animation (entrance or exit) -
  // flying elements can extend beyond the viewport (vw/vh-based
  // translation) and trigger the browser's own scrollbar to appear
  // during the animation, regardless of this page's own overflow
  // setting, since that's a property of the document, not this element.
  useEffect(() => {
    const isAnimating = isExiting || !hasEntered
    document.body.style.overflow = isAnimating ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isExiting, hasEntered])

  // Auto-focus on mount so the device's native number pad opens immediately.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // If already authenticated (e.g. navigated back to /login manually),
  // bounce straight to the home dashboard. Guarded against isExiting so
  // this doesn't fire the instant a fresh login succeeds and sets user -
  // that case is handled by submitPin's own delayed navigate, which lets
  // the exit animation actually play before leaving this screen.
  useEffect(() => {
    if (user && !isExiting) navigate('/', { replace: true })
  }, [user, isExiting, navigate])

  const submitPin = async (value) => {
    setIsSubmitting(true)

    const matchedUser = await login(value)

    if (matchedUser) {
      // Buttons/title/dots each fly outward and fade individually - by
      // the time FLY_MS completes, everything visible has already
      // faded to opacity:0 on its own, so navigate immediately after
      // rather than adding a second, redundant outer-container fade on
      // top of that (which only doubled the black-screen duration for
      // no visual benefit). The welcome toast is delayed to fire
      // alongside navigate() - not immediately here - so it appears
      // once the user is actually on Home, not while the exit
      // animation is still playing.
      setIsExiting(true)
      setTimeout(() => {
        navigate('/')
        const welcomeToastId = toast(`Welcome back, ${matchedUser.nickname || matchedUser.name}! 🎉`, {
          icon: '👋',
          duration: 4000,
          style: {
            background: '#171717',
            color: '#00FFA3',
            boxShadow: '0 0 20px -4px rgba(0,255,163,0.5)',
            fontSize: '1.1rem',
            fontWeight: 700,
            padding: '16px 20px',
          },
        })

        // Dismiss as soon as the user does anything - scrolls, touches,
        // or clicks - rather than making them wait out the full
        // duration. Attached to document (not this component, which
        // unmounts right after navigate() below) so it keeps working
        // regardless of the route change.
        const dismissWelcomeToast = () => {
          toast.dismiss(welcomeToastId)
          document.removeEventListener('scroll', dismissWelcomeToast, true)
          document.removeEventListener('touchstart', dismissWelcomeToast)
          document.removeEventListener('click', dismissWelcomeToast)
        }
        document.addEventListener('scroll', dismissWelcomeToast, true)
        document.addEventListener('touchstart', dismissWelcomeToast)
        document.addEventListener('click', dismissWelcomeToast)
      }, ANIMATION_MS * 0.75)
    } else {
      toast.error('Invalid access PIN')
      setPin('')
      inputRef.current?.focus()
      setIsSubmitting(false)
    }
  }

  const appendDigit = async (digit) => {
    if (isSubmitting || pin.length >= PIN_LENGTH) return

    const next = pin + digit
    setPin(next)

    if (next.length === PIN_LENGTH) {
      await submitPin(next)
    }
  }

  const handleBackspace = () => setPin((prev) => prev.slice(0, -1))
  const handleClear = () => setPin('')

  const handleInputChange = async (e) => {
    const value = e.target.value.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH)
    setPin(value)

    if (value.length === PIN_LENGTH) {
      await submitPin(value)
    }
  }

  return (
    <div className={`relative flex min-h-screen flex-col items-center justify-center px-6 ${(isExiting || !hasEntered) ? 'overflow-hidden' : ''}`}>
      <p className="pointer-events-none absolute bottom-14 left-1/2 -translate-x-1/2 select-none text-xs tracking-wide text-neutral-500 opacity-20">
        by ArVee
      </p>
      {/* Version label - sits below "by ArVee" with its own generous
          bottom offset (not just a smaller font under it) so it stays
          clear of the home-indicator/gesture-bar area on short mobile
          viewports. Slightly more visible than "by ArVee" (opacity-35
          vs 20) since it's meant to be legible enough to actually
          confirm the deployed version, not purely decorative. */}
      <p className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 select-none px-4 text-center text-[10px] tracking-wide text-neutral-500 opacity-35">
        v{APP_VERSION}
      </p>
      <div className="w-full max-w-sm">
        <img
          src="/logo.svg"
          alt="BSM App logo"
          style={(isExiting || !hasEntered) ? flyTransformUp : undefined}
          className="mx-auto mb-4 h-20 w-20 rounded-2xl transition-all duration-[1400ms]"
        />
        <h1
          style={(isExiting || !hasEntered) ? flyTransformUp : undefined}
          className="text-center text-2xl font-semibold text-app-text transition-all duration-[1400ms]"
        >
          BSM App
        </h1>
        <p
          style={(isExiting || !hasEntered) ? flyTransformUp : undefined}
          className="mt-1 text-center text-sm text-neutral-400 transition-all duration-[1400ms]"
        >
          Enter your access PIN
        </p>

        {/* type="number" per Section 2.3 — triggers the device-native
            numeric keypad on focus. Visually hidden; the grid below is the
            primary input surface. */}
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          autoFocus
          disabled={isSubmitting}
          value={pin}
          onChange={handleInputChange}
          className="sr-only"
          aria-label="Access PIN"
        />

        {/* PIN progress dots */}
        <div className="mt-8 flex justify-center gap-3">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              style={{
                transition: 'transform 1400ms, opacity 1400ms, border-color 150ms, background-color 150ms',
                ...((isExiting || !hasEntered) ? flyTransformHorizontal(i) : {}),
              }}
              className={`h-4 w-4 rounded-full border ${
                i < pin.length
                  ? 'border-brand-neon bg-brand-neon'
                  : 'border-neutral-700 bg-transparent'
              }`}
            />
          ))}
        </div>

        {/* Custom numeric keypad - on a successful login, each button
            flies outward from the grid's own center (like a door/portal
            opening), then the whole screen fades before navigating. */}
        <div className="mt-10 grid grid-cols-3 gap-4">
          {KEYPAD_DIGITS.map((digit, i) => (
            <button
              key={digit}
              type="button"
              disabled={isSubmitting}
              onClick={() => appendDigit(digit)}
              style={{
                transition: `transform ${(isExiting || !hasEntered) ? '1400ms' : '100ms'}, opacity 1400ms, background-color 150ms, border-color 150ms, box-shadow 150ms`,
                ...((isExiting || !hasEntered) ? flyTransform(i) : {}),
              }}
              className="rounded-2xl border border-neutral-800 bg-neutral-900 py-4 text-xl font-medium text-app-text hover:border-neutral-600 hover:bg-neutral-800 hover:shadow-[0_0_12px_rgba(255,255,255,0.08)] active:scale-95 disabled:opacity-50"
            >
              {digit}
            </button>
          ))}

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleClear}
            style={{
              transition: `transform ${(isExiting || !hasEntered) ? '1400ms' : '100ms'}, opacity 1400ms, background-color 150ms, border-color 150ms, color 150ms`,
              ...((isExiting || !hasEntered) ? flyTransform(9) : {}),
            }}
            className="rounded-2xl border border-neutral-800 bg-neutral-900 py-4 text-sm font-medium text-neutral-400 hover:border-neutral-600 hover:text-app-text active:scale-95 disabled:opacity-50"
          >
            Clear
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => appendDigit('0')}
            style={{
              transition: `transform ${(isExiting || !hasEntered) ? '1400ms' : '100ms'}, opacity 1400ms, background-color 150ms, border-color 150ms, box-shadow 150ms`,
              ...((isExiting || !hasEntered) ? flyTransform(10) : {}),
            }}
            className="rounded-2xl border border-neutral-800 bg-neutral-900 py-4 text-xl font-medium text-app-text hover:border-neutral-600 hover:bg-neutral-800 hover:shadow-[0_0_12px_rgba(255,255,255,0.08)] active:scale-95 disabled:opacity-50"
          >
            0
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleBackspace}
            aria-label="Backspace"
            style={{
              transition: `transform ${(isExiting || !hasEntered) ? '1400ms' : '100ms'}, opacity 1400ms, background-color 150ms`,
              ...((isExiting || !hasEntered) ? flyTransform(11) : {}),
            }}
            className="rounded-2xl border border-neutral-800 bg-neutral-900 py-4 text-xl font-medium text-app-text active:bg-neutral-800 disabled:opacity-50"
          >
            ⌫
          </button>
        </div>
      </div>
    </div>
  )
}

export default Login
