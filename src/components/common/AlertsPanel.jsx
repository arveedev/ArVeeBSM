// AlertsPanel — merges the Procurement-sacks-need-SIA and Palay-drying
// notifications (previously each rendered as its own always-expanded,
// full-width colored banner directly on Home) into a single collapsed-
// by-default strip with a count badge, matching the app's existing
// collapsible-section convention (see Milling Operations in Home.jsx).
// Collapsed by default so a warehouse with several active alerts
// doesn't stack up multiple loud banners before the user even reaches
// the stock data.
//
// Each underlying notification component decides independently (via
// its own useLiveQuery) whether it has anything to show, returning
// null otherwise - rather than duplicating that query logic here just
// to compute a count, a MutationObserver watches the always-mounted
// body wrapper's actual child count. Toggling `hidden` on that same
// wrapper doesn't remove the children from the DOM, so the observer
// keeps an accurate count whether the strip is expanded or not - and a
// count of zero (nothing currently active) hides the header entirely,
// matching the previous "no notification = no visual trace" behavior.

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import ProcurementBagsNotification from './ProcurementBagsNotification.jsx'
import PalayDryingStatus from './WetPalayNotification.jsx'

function AlertsPanel() {
  const [count, setCount] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const bodyRef = useRef(null)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const update = () => setCount(el.children.length)
    update()
    const observer = new MutationObserver(update)
    observer.observe(el, { childList: true })
    return () => observer.disconnect()
  }, [])

  return (
    <>
      {count > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((o) => !o)}
          className="mt-3 flex w-full items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-left transition-all active:scale-[0.99]"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-brand-amber" />
            <span className="text-sm font-bold text-app-text">Alerts</span>
            <span className="rounded-full bg-brand-amber px-1.5 py-0.5 text-[10px] font-extrabold text-neutral-950">
              {count}
            </span>
          </span>
          <ChevronDown size={18} className={`text-neutral-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
      {/* animate-flow-down is unconditional (not retriggered via a key
          or JS) - toggling `hidden` (display:none) already resets a CSS
          animation on its own, so it replays every time this becomes
          visible again, same technique used for Reports.jsx's tabs. */}
      <div ref={bodyRef} className={expanded && count > 0 ? 'mt-2 space-y-2 animate-flow-down' : 'hidden'}>
        <ProcurementBagsNotification />
        <PalayDryingStatus />
      </div>
    </>
  )
}

export default AlertsPanel
