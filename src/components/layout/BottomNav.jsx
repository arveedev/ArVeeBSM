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

import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Home, LayoutGrid, FileText, Settings, Plus, Radar } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'

function BottomNav({ onFabClick }) {
  const { user } = useAuth() ?? {}
  const isAdmin = user?.role === 'Admin'
  const isVisitor = user?.role === 'Visitor'
  const [hasEntered, setHasEntered] = useState(false)

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

  if (isVisitor) {
    return (
      <nav style={slideStyle} className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-900">
        <div className="pointer-events-none absolute inset-x-0 bottom-full h-4 bg-gradient-to-t from-neutral-900 to-transparent" />
        <div className="mx-auto grid h-16 max-w-md grid-cols-2 items-center">
          <NavItem to="/" label="Home" Icon={Home} />
          <NavItem to="/monitoring" label="Monitor" Icon={Radar} />
        </div>
      </nav>
    )
  }

  return (
    <nav style={slideStyle} className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-900">
      <div className="pointer-events-none absolute inset-x-0 bottom-full h-4 bg-gradient-to-t from-neutral-900 to-transparent" />
      <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
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
        `flex flex-col items-center justify-center gap-0.5 text-xs transition-colors hover:text-brand-neon/70 active:scale-95 ${
          isActive ? 'text-brand-neon' : 'text-neutral-400'
        }`
      }
    >
      <Icon size={24} />
      <span>{label}</span>
    </NavLink>
  )
}

export default BottomNav
