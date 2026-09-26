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

// Same (pointer: coarse) check used elsewhere (AnimatedToast.jsx,
// Piles.jsx) to distinguish a touch device from a PC.
const isTouchDevicePointer = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches)

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

/** Downward fly-and-fade for the "by ArVee"/version block - it sits
 * fixed at the very bottom of the screen, so it flies further down
 * and out rather than up, matching its own position instead of every
 * other element's upward direction. Previously didn't animate at all -
 * everything else in this exit sequence moves, this shouldn't be the
 * one thing left sitting still.
 *
 * This element is centered via the Tailwind class -translate-x-1/2
 * (paired with left-1/2) - since an inline style.transform fully
 * REPLACES whatever transform the Tailwind class would have set (not
 * additive), both states here explicitly include translateX(-50%) so
 * the centering is never lost while this is animating. */
const restTransformCentered = { transform: 'translateX(-50%)' }
const flyTransformDown = { transform: 'translateX(-50%) translateY(10vh) scale(0.9)', opacity: 0 }

function Login() {
  const [pin, setPin] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isExiting, setIsExiting] = useState(false)
  // Bumped on a wrong PIN, purely to force the dots row to remount and
  // replay its shake keyframe every time (a plain CSS class toggle
  // wouldn't retrigger on a second consecutive wrong attempt, since the
  // class would already be present).
  const [shakeKey, setShakeKey] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const { user, login } = useAuth()

  // Entrance animation ("Magnetic Snap" + "Scan Reveal", picked after
  // several rounds of demos) - real @keyframes (animate-login-*-in /
  // animate-login-key-reveal, index.css), not the transition-based
  // reverse-of-the-exit approach this used to be. No hasEntered state
  // needed any more: these keyframes just play automatically on mount,
  // with their own built-in delays/durations, and (deliberately, see
  // index.css's own comment) no forwards/both fill-mode - once each one
  // finishes it fully releases the transform/opacity properties it
  // touched, so the UNCHANGED exit code below (isExiting) can still
  // freely apply its own inline-style fly-out afterward without a held
  // animation frame silently fighting it.

  // Lock body scroll only while the exit is flying - its vw/vh-based
  // translations can genuinely extend past the viewport and trigger the
  // browser's own scrollbar mid-animation. The entrance's own
  // translations are all small, in-bounds pixel offsets (see index.css),
  // so it never needs this.
  useEffect(() => {
    document.body.style.overflow = isExiting ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isExiting])

  // Reported real bug: this separate mount-time focus() call was ALSO
  // unconditionally focusing the hidden input on every device,
  // regardless of touch/pointer type - completely bypassing the
  // autoFocus={!isTouchDevicePointer()} guard on the input itself below
  // and still popping the OS virtual keyboard on a real touch device.
  // Removed entirely - autoFocus already covers this exact "focus on
  // mount" behavior for the one case (desktop/physical keyboard) that
  // actually needs it.

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
        // Was passing a custom `style` object here, but AnimatedToast
        // (the app's single custom renderer, hooked in once at the
        // Toaster level) never reads t.style at all - every toast goes
        // through its own type-based rendering instead, so that whole
        // object was silently doing nothing. toast.success gets the
        // real edge-strip + checkmark treatment every other success
        // toast already has, instead of a dead custom style object.
        const welcomeToastId = toast.success(`Welcome back, ${matchedUser.nickname || matchedUser.name}! 🎉`)

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
      setShakeKey((k) => k + 1)
      setIsSubmitting(false)
      // Deferred, not called inline: the hidden input is still
      // `disabled` (from isSubmitting) in the actual DOM right here -
      // the setIsSubmitting(false) above hasn't been rendered yet, React
      // only commits it after this handler finishes - and a disabled
      // element silently refuses focus(). That left the input neither
      // focused nor re-focusable afterward (no blur event ever fires to
      // trigger handlePinInputBlur's own refocus, since focus never
      // actually landed), so physical keyboard typing stopped working
      // after any wrong PIN - reported directly. setTimeout(0) waits for
      // the re-render to actually commit (enabling the input) before
      // focusing it, same pattern handlePinInputBlur already uses below.
      // Same isTouchDevicePointer() guard as handlePinInputBlur - this
      // was the other spot silently refocusing (and re-popping the
      // virtual keyboard) on a touch device after every wrong attempt.
      if (!isTouchDevicePointer()) setTimeout(() => inputRef.current?.focus(), 0)
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

  // Real bug found, reported directly: a separate document-level
  // keydown listener used to live here, doing its own appendDigit call
  // on top of the hidden input below (type="number", already wired to
  // handleInputChange) - since that hidden input is normally focused,
  // EVERY physical keypress fired both paths at once, double-entering
  // every digit. There was never a missing physical-keyboard feature to
  // add - the hidden input already handles it; the real gap was that
  // clicking an on-screen keypad button steals focus away from it, so
  // typing stops working until the user clicks back in manually. Fixed
  // at the actual gap instead: refocusing the hidden input (PC only)
  // whenever it loses focus, so physical typing keeps routing through
  // the one real handler no matter what was just clicked. Mobile is
  // unaffected - stealing focus back there would fight the on-screen
  // native keyboard's own show/hide behavior.
  const handlePinInputBlur = () => {
    if (isTouchDevicePointer() || isSubmitting) return
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleInputChange = async (e) => {
    const value = e.target.value.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH)
    setPin(value)

    if (value.length === PIN_LENGTH) {
      await submitPin(value)
    }
  }

  return (
    <div className={`relative flex min-h-screen flex-col items-center justify-center px-6 ${isExiting ? 'overflow-hidden' : ''}`}>
      {/* "by ArVee" and the version sit as one tight block, not two
          independently-positioned lines - on a short viewport that
          used to mean only one of them was ever visible at once.
          `fixed`, not `absolute`: the outer container is
          `min-h-screen` + centered content (logo/title/PIN dots/
          keypad), which on a real phone (safe-area insets, on-screen
          address bar, etc.) can genuinely be taller than the visible
          viewport - an `absolute` block pins to the BOTTOM OF THAT
          TALLER CONTAINER, which sits below the fold and needs a
          scroll to ever see. `fixed` pins to the viewport itself,
          so it's always on screen regardless of how tall the content
          above it grows. */}
      <div
        style={{
          transition: 'transform 1400ms, opacity 1400ms',
          ...(isExiting ? flyTransformDown : restTransformCentered),
        }}
        className="pointer-events-none fixed bottom-8 left-1/2 z-10 flex select-none flex-col items-center gap-0.5 px-4 text-center"
      >
        <p className="text-xs tracking-wide text-neutral-500 opacity-20">by ArVee</p>
        <p className="text-[10px] tracking-wide text-neutral-500 opacity-35">v{APP_VERSION}</p>
      </div>
      <div className="w-full max-w-sm">
        <img
          src="/logo.svg"
          alt="BSM App logo"
          style={isExiting ? flyTransformUp : undefined}
          className={`mx-auto mb-4 h-20 w-20 rounded-2xl transition-all duration-[1400ms] ${!isExiting ? 'animate-login-logo-in' : ''}`}
        />
        <h1
          style={isExiting ? flyTransformUp : undefined}
          className={`text-center text-2xl font-semibold text-app-text transition-all duration-[1400ms] ${!isExiting ? 'animate-login-title-in' : ''}`}
        >
          BSM App
        </h1>
        <p
          style={isExiting ? flyTransformUp : undefined}
          className={`mt-1 text-center text-sm text-neutral-400 transition-all duration-[1400ms] ${!isExiting ? 'animate-login-subtitle-in' : ''}`}
        >
          Enter your access PIN
        </p>

        {/* Reported real bug: on a real mobile device, autoFocus on
            this hidden input still popped the OS's own virtual
            keyboard on page load, even though it's visually hidden and
            the on-screen number grid below is the intended, sole input
            surface. inputMode="none" alone turned out NOT reliable
            enough - confirmed still showing the OS keyboard on a real
            Android device even with it set, a known inconsistency with
            some mobile browsers/keyboards (Gboard included). The real
            fix: autoFocus itself is now conditional on
            !isTouchDevicePointer() (the same touch-device check
            handlePinInputBlur below already trusts for this exact
            concern) - a touch device never focuses this input at all,
            so no virtual keyboard can ever be triggered by it, while a
            desktop mouse/pointer device still autofocuses it for
            physical-keyboard entry. appendDigit (the on-screen keypad's
            own click handler) never depended on this input having
            focus in the first place, so touch input is completely
            unaffected either way. */}
        <input
          ref={inputRef}
          type="number"
          inputMode="none"
          autoFocus={!isTouchDevicePointer()}
          disabled={isSubmitting}
          value={pin}
          onChange={handleInputChange}
          onBlur={handlePinInputBlur}
          className="sr-only"
          aria-label="Access PIN"
        />

        {/* PIN progress dots - shakeKey remounts this whole row on a
            wrong PIN, replaying animate-pin-dots-shake even on repeated
            wrong attempts in a row (a plain class toggle wouldn't
            retrigger if the class were already present). */}
        {/* Real conflict avoided here: animate-login-dots-in and
            animate-pin-dots-shake are two separate classes each setting
            their own `animation` shorthand - an element only has one
            `animation` property, so having BOTH present at once would
            let whichever class sits later in index.css's cascade order
            silently win outright rather than the two combining, which
            would have broken the wrong-PIN shake the very first time it
            fired alongside a remount. The entrance class is gated to
            shakeKey === 0 (the very first mount only) specifically so
            it never coexists with the shake class on the same element. */}
        <div key={shakeKey} className={`mt-8 flex justify-center gap-3 ${shakeKey > 0 ? 'animate-pin-dots-shake' : (!isExiting ? 'animate-login-dots-in' : '')}`}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              // Remounts each dot exactly when ITS OWN filled-state
              // changes, so animate-pin-dot-pop (a keyframe, not a
              // plain transition) replays fresh every time a digit
              // actually lands - a bare className toggle wouldn't
              // replay a keyframe animation already present.
              key={i < pin.length ? `filled-${i}` : `empty-${i}`}
              style={{
                transition: 'transform 1400ms, opacity 1400ms, border-color 150ms, background-color 150ms',
                ...(isExiting ? flyTransformHorizontal(i) : {}),
              }}
              className={`h-4 w-4 rounded-full border ${
                i < pin.length
                  ? 'border-brand-neon bg-brand-neon animate-pin-dot-pop'
                  : 'border-neutral-700 bg-transparent'
              }`}
            />
          ))}
        </div>

        {/* Custom numeric keypad - on a successful login, each button
            flies outward from the grid's own center (like a door/portal
            opening), then the whole screen fades before navigating.
            On entrance instead (unrelated, unless isExiting is also
            true - never both at once), each button reveals via a scan
            line sweeping down it (animate-login-key-reveal on the
            button + animate-login-key-scanline on its own child <span>,
            both keyed to the same --key-i stagger, index.css). relative
            overflow-hidden is new here too - overflow-hidden keeps the
            scanline's glow contained to the button's own rounded rect
            while it travels, and does not affect the button's fly-out
            exit in any way (that's a transform, not a layout overflow). */}
        <div className="mt-10 grid grid-cols-3 gap-4">
          {KEYPAD_DIGITS.map((digit, i) => (
            <button
              key={digit}
              type="button"
              disabled={isSubmitting}
              onClick={() => appendDigit(digit)}
              style={{
                transition: `transform ${isExiting ? '1400ms' : '100ms'}, opacity 1400ms, background-color 150ms, border-color 150ms, box-shadow 150ms`,
                ...(isExiting ? flyTransform(i) : { '--key-i': i }),
              }}
              className={`relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 py-4 text-xl font-medium text-app-text hover:border-neutral-600 hover:bg-neutral-800 hover:shadow-[0_0_12px_rgba(255,255,255,0.08)] active:scale-95 disabled:opacity-50 ${!isExiting ? 'animate-login-key-reveal' : ''}`}
            >
              {digit}
              {!isExiting && <span className="animate-login-key-scanline pointer-events-none absolute left-0 right-0 h-0.5 bg-brand-neon opacity-0 shadow-[0_0_8px_1px_rgba(0,255,163,0.8)]" />}
            </button>
          ))}

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleClear}
            style={{
              transition: `transform ${isExiting ? '1400ms' : '100ms'}, opacity 1400ms, background-color 150ms, border-color 150ms, color 150ms`,
              ...(isExiting ? flyTransform(9) : { '--key-i': 9 }),
            }}
            className={`relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 py-4 text-sm font-medium text-neutral-400 hover:border-neutral-600 hover:text-app-text active:scale-95 disabled:opacity-50 ${!isExiting ? 'animate-login-key-reveal' : ''}`}
          >
            Clear
            {!isExiting && <span className="animate-login-key-scanline pointer-events-none absolute left-0 right-0 h-0.5 bg-brand-neon opacity-0 shadow-[0_0_8px_1px_rgba(0,255,163,0.8)]" />}
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => appendDigit('0')}
            style={{
              transition: `transform ${isExiting ? '1400ms' : '100ms'}, opacity 1400ms, background-color 150ms, border-color 150ms, box-shadow 150ms`,
              ...(isExiting ? flyTransform(10) : { '--key-i': 10 }),
            }}
            className={`relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 py-4 text-xl font-medium text-app-text hover:border-neutral-600 hover:bg-neutral-800 hover:shadow-[0_0_12px_rgba(255,255,255,0.08)] active:scale-95 disabled:opacity-50 ${!isExiting ? 'animate-login-key-reveal' : ''}`}
          >
            0
            {!isExiting && <span className="animate-login-key-scanline pointer-events-none absolute left-0 right-0 h-0.5 bg-brand-neon opacity-0 shadow-[0_0_8px_1px_rgba(0,255,163,0.8)]" />}
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleBackspace}
            aria-label="Backspace"
            style={{
              transition: `transform ${isExiting ? '1400ms' : '100ms'}, opacity 1400ms, background-color 150ms`,
              ...(isExiting ? flyTransform(11) : { '--key-i': 11 }),
            }}
            className={`relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 py-4 text-xl font-medium text-app-text active:bg-neutral-800 disabled:opacity-50 ${!isExiting ? 'animate-login-key-reveal' : ''}`}
          >
            ⌫
            {!isExiting && <span className="animate-login-key-scanline pointer-events-none absolute left-0 right-0 h-0.5 bg-brand-neon opacity-0 shadow-[0_0_8px_1px_rgba(0,255,163,0.8)]" />}
          </button>
        </div>
      </div>
    </div>
  )
}

export default Login
