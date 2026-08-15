// Bottom Navigation Bar — Step 4.1. Fixed at the bottom of the viewport,
// four primary routes plus a centered Floating Action Button (Step 4.2)
// that opens the TransactionModal.
//
// Admins have no warehouse of their own, so a "Piles" tab is meaningless
// for them — it's "Monitor" (/monitoring), a cross-warehouse AI/SIA
// oversight page, Admin-only. Everyone else keeps "Piles" (/piles) as the
// tab's identity — that page now also surfaces the AI/SIA monitor for
// their own warehouse(s), but it is still the Piles tab, not a Monitor
// tab, for regular users.
//
// Visitor gets a separate, minimal nav entirely: Home and Monitor only,
// no FAB, no Reports/Settings/Piles - a view-only role with no
// functionality, matching the routes ProtectedRoute actually allows it
// to reach.

import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Home, LayoutGrid, FileText, Settings, Plus, Radar } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'

// Retriggers the squash-and-stretch keyframe on every column change - a
// CSS animation (unlike a transition) does not restart on its own just
// because a class is still present, so the class has to be removed and
// re-added with a forced reflow (reading offsetWidth) in between, even
// when the previous play already finished. This runs on a ref instead of
// state so rapid consecutive taps each get their own fresh replay rather
// than colliding with a pending re-render.
const useSquashOnChange = (dep) => {
  const ref = useRef(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const el = ref.current
    if (!el) return
    el.classList.remove('animate-nav-pill-squash')
    void el.offsetWidth
    el.classList.add('animate-nav-pill-squash')
  }, [dep])
  return ref
}

// Column index of each route within the 5-column regular nav grid
// (index 2 is the FAB - never a nav target, so it's absent here) and
// the 2-column Visitor nav - used to position the sliding glow
// indicator. /piles and /monitoring share index 1 since a given user
// only ever sees one or the other.
export const REGULAR_NAV_COLUMN = { '/': 0, '/piles': 1, '/monitoring': 1, '/reports': 3, '/settings': 4 }
const VISITOR_NAV_COLUMN = { '/': 0, '/monitoring': 1 }

function BottomNav({ onFabClick }) {
  const { user } = useAuth() ?? {}
  const isAdmin = user?.role === 'Admin'
  const isVisitor = user?.role === 'Visitor'
  const [hasEntered, setHasEntered] = useState(false)
  const { pathname } = useLocation()

  // Slides up from below on mount - needs a tick of delay
  // (requestAnimationFrame) so the browser actually paints the
  // off-screen starting position first, before the transition to the
  // settled position is applied.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setHasEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const slideStyle = {
    transform: hasEntered ? 'translateY(0)' : 'translateY(100%)',
    transition: 'transform 350ms ease-out',
  }

  // The pill is always mounted (unlike the old transient glow, which
  // fully unmounted/remounted on every navigation and could only ever
  // animate from a remembered "previous" position - stale by the time a
  // second rapid tap interrupted it, which is what caused the reported
  // stutter/pause). Being a plain, always-present element driven purely
  // by a CSS transition on transform means the browser always continues
  // from whatever the pill's actual current on-screen position is,
  // interruption or not - there is no "from" value to go stale.
  const columnForSquash = (isVisitor ? VISITOR_NAV_COLUMN : REGULAR_NAV_COLUMN)[pathname] ?? 0
  const squashRef = useSquashOnChange(columnForSquash)

  if (isVisitor) {
    const visitorColumn = VISITOR_NAV_COLUMN[pathname] ?? 0
    return (
      <nav style={slideStyle} className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-900 pb-[env(safe-area-inset-bottom)]">
        <div className="pointer-events-none absolute inset-x-0 bottom-full h-4 bg-gradient-to-t from-neutral-900 to-transparent" />
        <div className="relative mx-auto grid h-16 max-w-md grid-cols-2 items-center">
          {/* The pill lives in its own absolutely-positioned, exactly-
              row-sized overflow-hidden wrapper - not on the row div
              itself - so the elastic bounce's slight overshoot on the
              edge columns gets clipped to the row's own bounds (it was
              previously poking a few pixels past the row's edge
              mid-animation, enough to register as horizontal page
              overflow on some browsers: a scrollbar flickering in and
              out on every tap, with the whole page visibly flinching
              along with it) without this wrapper also having to contain
              - and thus potentially clip - anything else in the row. */}
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            {/* The pill box's own width must equal exactly one grid
                column (50% here) for translateX(N * 100%) to land each
                column dead-on - percentage translateX is relative to
                the element's OWN box, not the container, so shrinking
                this box for a gutter (as a first attempt did) made each
                step short by that same amount, an error that compounds
                with every column and is exactly what made the pill
                drift out from under its icon on columns further from
                the left. The gutter is applied to the inner squash
                element instead, which does not affect this box's
                translate math. */}
            <div
              className="absolute inset-y-2 w-1/2 transition-nav-elastic"
              style={{ transform: `translateX(${visitorColumn * 100}%)` }}
            >
              <div ref={squashRef} className="mx-1 h-full rounded-2xl bg-brand-neon" />
            </div>
          </div>
          <NavItem to="/" label="Home" Icon={Home} />
          <NavItem to="/monitoring" label="Monitor" Icon={Radar} />
        </div>
      </nav>
    )
  }

  const regularColumn = REGULAR_NAV_COLUMN[pathname] ?? 0
  return (
    <nav style={slideStyle} className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-900 pb-[env(safe-area-inset-bottom)]">
      <div className="pointer-events-none absolute inset-x-0 bottom-full h-4 bg-gradient-to-t from-neutral-900 to-transparent" />
      <div className="relative mx-auto grid h-16 max-w-md grid-cols-5 items-center">
        {/* Clipping wrapper scoped to just the pill, same reasoning as
            the Visitor nav above - deliberately NOT overflow-hidden on
            this whole row, since the FAB button below intentionally
            pokes up above the row (-translate-y-5) and would otherwise
            get its top clipped off. */}
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          {/* Same self-width-must-equal-one-column reasoning as the
              Visitor nav above - box is exactly 1/5, gutter lives on
              the inner squash element only. */}
          <div
            className="absolute inset-y-2 w-1/5 transition-nav-elastic"
            style={{ transform: `translateX(${regularColumn * 100}%)` }}
          >
            <div ref={squashRef} className="mx-1 h-full rounded-2xl bg-brand-neon" />
          </div>
        </div>

        <NavItem to="/" label="Home" Icon={Home} />
        {isAdmin ? (
          <NavItem to="/monitoring" label="Monitor" Icon={Radar} />
        ) : (
          <NavItem to="/piles" label="Piles" Icon={LayoutGrid} />
        )}

        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={onFabClick}
            aria-label="New transaction"
            className="-translate-y-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-neon text-brand-contrast shadow-lg shadow-brand-neon/30 transition-all hover:brightness-110 hover:shadow-[0_0_24px_rgba(0,255,163,0.55)] active:scale-95"
          >
            <Plus size={28} strokeWidth={2.5} />
          </button>
        </div>

        <NavItem to="/reports" label="Reports" Icon={FileText} />
        <NavItem to="/settings" label="Settings" Icon={Settings} />
      </div>
    </nav>
  )
}

function NavItem({ to, label, Icon }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `relative z-10 flex flex-col items-center justify-center gap-0.5 text-xs transition-colors active:scale-95 ${
          isActive ? 'text-brand-contrast' : 'text-neutral-400 hover:text-brand-neon/70'
        }`
      }
    >
      <Icon size={24} />
      <span>{label}</span>
    </NavLink>
  )
}

export default BottomNav
