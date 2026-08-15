// App Header — persistent, always-visible bar (sticky, not scrolling
// away with page content). Houses the current page's title/subtitle
// (set by each page via PageHeaderContext, so it stays visible without
// scrolling back up), the dark/light theme toggle, the KG/MT weight
// unit toggle, and logout - all in one place instead of requiring a
// trip into Settings. Theme defaults to dark, weight unit defaults to
// KG; both persisted via SettingsContext. Hidden entirely while a
// transaction form is open (App.jsx skips rendering it), since those
// are their own full-screen overlays with their own close control.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Moon, Sun, LogOut, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useSettings } from '../../context/SettingsContext.jsx'
import { usePageHeader } from '../../context/PageHeaderContext.jsx'
import ConfirmDialog from '../common/ConfirmDialog.jsx'

// Must match the fade transition duration used on the overlay below.
const LOGOUT_FADE_MS = 500

function AppHeader({ hidden = false }) {
  const { logout } = useAuth() ?? {}
  const { theme, weightUnit, updateSetting } = useSettings() ?? {}
  const { title, subtitle, setHeaderHeight } = usePageHeader() ?? {}
  const navigate = useNavigate()
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [hasEntered, setHasEntered] = useState(false)
  const headerRef = useRef(null)

  // Slides down from above on mount - needs a tick of delay
  // (requestAnimationFrame) so the browser actually paints the
  // off-screen starting position first, before the transition to the
  // settled position is applied.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setHasEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Reports the header's actual rendered height (not a guess) so
  // anything elsewhere positioned "just below the header" - like the
  // sticky warehouse indicator - uses the real number for this specific
  // page, since a page with no subtitle renders a shorter header than
  // one with a long "Welcome back..." line.
  useEffect(() => {
    const el = headerRef.current
    if (!el || !setHeaderHeight) return
    const observer = new ResizeObserver(([entry]) => setHeaderHeight(entry.contentRect.height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [setHeaderHeight])

  const isLight = theme === 'light'
  const isMt = weightUnit === 'mt'

  const handleLogoutConfirmed = () => {
    setConfirmingLogout(false)
    // Fade the whole screen to black first (the reverse counterpart to
    // Login's own exit animation), THEN actually log out and navigate -
    // reads as one continuous transition rather than an abrupt jump
    // straight to the login screen.
    document.body.style.overflow = 'hidden'
    setIsLoggingOut(true)
    setTimeout(() => {
      document.body.style.overflow = ''
      logout?.()
      navigate('/login', { replace: true })
    }, LOGOUT_FADE_MS)
  }

  return (
    <>
      <div
        ref={headerRef}
        style={{
          // hidden - previously a transaction form opening simply
          // unmounted this component outright (App.jsx conditionally
          // rendered it on !activeFormType), so it vanished instantly
          // with no exit motion at all, and reappeared the same way -
          // abrupt in both directions, and never coordinated with the
          // form's own fade timing. Now it stays mounted and slides up
          // out of view instead, matching hasEntered's own transition
          // so opening a form reads as one combined motion (header
          // slides up, nav bar slides down, form fades in) rather than
          // a jump cut plus a separate animation.
          transform: (hasEntered && !hidden) ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 350ms ease-out',
        }}
        className="sticky top-0 z-50 border-b border-neutral-800 bg-neutral-950"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <div className="min-w-0">
            {title && <h1 className="truncate text-lg font-semibold text-app-text">{title}</h1>}
            {subtitle && <p className="truncate text-sm font-medium text-neutral-300">{subtitle}</p>}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* KG/MT weight unit toggle - shows both labels at once with
                the active one highlighted, so the current state is
                unambiguous at a glance rather than relying on a single icon. */}
            <button
              type="button"
              onClick={() => updateSetting?.('weightUnit', isMt ? 'kg' : 'mt')}
              aria-label="Toggle KG/MT weight unit"
              className="flex items-center overflow-hidden rounded-full border border-neutral-800 bg-neutral-900 text-xs font-bold"
            >
              <span className={`px-2.5 py-2 transition-colors ${!isMt ? 'bg-brand-neon text-brand-contrast' : 'text-neutral-400'}`}>
                KG
              </span>
              <span className={`px-2.5 py-2 transition-colors ${isMt ? 'bg-brand-neon text-brand-contrast' : 'text-neutral-400'}`}>
                MT
              </span>
            </button>

            {/* Dark/light theme toggle - glows when light mode is active,
                as a clear visual cue of the current state. */}
            <button
              type="button"
              onClick={() => updateSetting?.('theme', isLight ? 'dark' : 'light')}
              aria-label="Toggle dark/light mode"
              className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all active:scale-90 ${
                isLight
                  ? 'border-brand-neon bg-neutral-900 text-brand-neon shadow-[0_0_12px_rgba(0,255,163,0.6)]'
                  : 'border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-brand-neon/50 hover:text-brand-neon'
              }`}
            >
              {isLight ? <Sun size={20} /> : <Moon size={20} />}
            </button>

            <button
              type="button"
              onClick={() => setConfirmingLogout(true)}
              aria-label="Logout"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-900 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>

        {/* Fade attached to the header's own bottom edge (not a fixed
            pixel offset) so content scrolling underneath fades smoothly
            rather than being cut off abruptly - works regardless of the
            header's actual height, since this moves with it. */}
        <div className="pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-neutral-950 to-transparent" />
      </div>

      <ConfirmDialog
        open={confirmingLogout}
        title="Are you sure you want to log out?"
        confirmLabel="Logout"
        icon={AlertTriangle}
        onConfirm={handleLogoutConfirmed}
        onCancel={() => setConfirmingLogout(false)}
      />

      {/* Fades the whole screen to black on logout - the reverse
          counterpart to Login's own fade-out, so this reads as one
          continuous transition rather than an abrupt jump. */}
      <div
        className={`fixed inset-0 z-[100] bg-neutral-950 transition-opacity duration-500 ${
          isLoggingOut ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
    </>
  )
}

export default AppHeader
