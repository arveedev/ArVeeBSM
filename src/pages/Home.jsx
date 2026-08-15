// Home - Dynamic Facility Status Core Overview (Step 4.4).
// Thin container: warehouse selector, inventory tab state, delegates to
// HomeStocks/HomeSacks. The pile list moved to its own tab on the Piles
// page (alongside the layout editor) - it no longer lives on Home.

import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import useDelayedUnmount from '../hooks/useDelayedUnmount.js'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import AuthorityMonitor from '../components/common/AuthorityMonitor.jsx'
import MillingMonitor from '../components/common/MillingMonitor.jsx'
import NfaMillingMonitor from '../components/common/NfaMillingMonitor.jsx'
import { Factory, ChevronDown, ChevronUp } from 'lucide-react'
import SectionErrorBoundary from '../components/common/SectionErrorBoundary.jsx'
import AlertsPanel from '../components/common/AlertsPanel.jsx'
import StickyWarehouseIndicator from '../components/common/StickyWarehouseIndicator.jsx'
import HomeStocks from './HomeStocks.jsx'
import HomeSacks from './HomeSacks.jsx'

const PAGE_TABS = [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity' }]

const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })

function Home() {
  const { user } = useAuth()
  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } =
    useWarehouse() ?? {}
  const { setPageHeader } = usePageHeader() ?? {}
  const hasMillingOrders = (useLiveQuery(() => db.millingOrders.count(), []) ?? 0) > 0
  // NFA-owned Ricemills/Mechanical Dryers don't use MO/TMO numbers at
  // all (a separate rule, see RicemillAllocationsPanel.jsx) - the
  // generic Milling Operations (MO/TMO) list is irrelevant to them.
  // A Ricemill facility gets its own NFA allocation/usage monitor in
  // its place; a Dryer facility's own monitor is PalayDryingStatus
  // (already shown unconditionally below), so the MO/TMO section is
  // simply not relevant there and stays hidden rather than duplicated.
  const isRicemillFacility = currentWarehouse?.facilityType === 'Ricemill'
  const isDryerFacility = currentWarehouse?.facilityType === 'Mechanical Dryer'
  const showMillingSection = isRicemillFacility || (hasMillingOrders && !isDryerFacility)

  // Overview = warehouse selector + Stocks/Sacks card + alerts (the
  // things checked most often); Activity = Milling Operations + AI/SIA
  // Monitor (both already collapsible on their own). Splitting these
  // into two top-level tabs, rather than stacking everything on one
  // screen, mirrors the same Summary/Stock Statement split just added
  // to Reports.jsx.
  const [pageTab, setPageTab] = useState('overview')
  const [inventoryTab, setInventoryTab] = useState('stocks')
  const [showMillingMonitor, setShowMillingMonitor] = useState(false)
  const shouldRenderMillingMonitor = useDelayedUnmount(showMillingMonitor, 250)
  // Tracks whether the current open/closed state was reached via an
  // explicit user tap, versus just being carried over into a remount
  // caused by the warehouse switching - only the former should play
  // its own entrance/exit animation. Without this, switching
  // warehouses while this was already open played two overlapping
  // animations at once (the outer warehouse-switch flow-down AND this
  // section's own toggle animation), which is what caused the
  // reported stutter.
  const millingToggledByUserRef = useRef(false)
  useEffect(() => {
    millingToggledByUserRef.current = false
  }, [currentWarehouseId])
  // inventoryTab lives here in the parent, above the key={currentWarehouseId}
  // remount boundary on the panels below - so without this, switching
  // warehouses while on the Sacks tab left the Sacks tab selected for
  // the new warehouse too, since nothing was actually telling it to
  // reset back to the default.
  useEffect(() => {
    setInventoryTab('stocks')
  }, [currentWarehouseId])
  const warehouseSectionRef = useRef(null)

  const sortedWarehouses = [...(accessibleWarehouses ?? [])].sort((a, b) => byAlpha(a.name, b.name))

  useEffect(() => {
    setPageHeader?.({ title: 'Home', subtitle: `Welcome back, ${user?.nickname ?? ''}.` })
  }, [user?.nickname])

  return (
    <div className="min-h-screen px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6">
      <div ref={warehouseSectionRef}>
        {sortedWarehouses.length > 1 ? (
          <div className="mt-4">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">Warehouse</label>
            <select
              value={currentWarehouseId ?? ''}
              onChange={(e) => setCurrentWarehouseId(e.target.value)}
              className="mt-1 w-full rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-3 text-base font-semibold text-app-text outline-none focus:border-brand-neon"
            >
              {sortedWarehouses.map((w) => (
                <option key={w.warehouseId} value={w.warehouseId}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </div>
        ) : currentWarehouse ? (
          <div className="mt-4 rounded-lg border-2 border-brand-neon/50 bg-neutral-950 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-neon">Warehouse</p>
            <p className="text-base font-bold text-app-text">
              {currentWarehouse.code} — {currentWarehouse.name}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-neutral-500">No warehouse assigned yet.</p>
        )}
      </div>

      <StickyWarehouseIndicator targetRef={warehouseSectionRef} warehouse={currentWarehouse} />

      {/* Page-level Overview / Activity tabs - same full-width sliding
          pill pattern as Reports.jsx's Summary/Stock Statement tabs. */}
      <div className="relative mt-4 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
        <div
          className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
          style={{ transform: pageTab === 'overview' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
        />
        {PAGE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setPageTab(t.id)}
            className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-semibold transition-all active:scale-95 ${
              pageTab === t.id ? 'text-brand-contrast' : 'text-neutral-400 hover:text-app-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Both tab panels stay mounted (visibility toggled via `hidden`,
          not conditional rendering) - the child sections below all call
          useLiveQuery internally, so switching tabs would otherwise
          briefly flash an empty state on remount. animate-flow-down is
          unconditional - toggling `hidden` (display:none) already
          resets a CSS animation on its own, so it replays every time a
          panel becomes visible again, same technique used in
          Reports.jsx. */}
      <div key={`overview-${currentWarehouseId}`} className={`stagger-fields animate-flow-down ${pageTab === 'overview' ? '' : 'hidden'}`}>
        {/* Inventory: Stocks / Sacks tabs - a sliding pill indicator moves
            behind whichever tab is active, rather than each tab's own
            background just jumping to a new color instantly. */}
        <div className="relative mt-4 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
          <div
            className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
            style={{ transform: inventoryTab === 'stocks' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
          />
          {['stocks', 'sacks'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setInventoryTab(tab)}
              className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium capitalize transition-colors active:scale-95 ${
                inventoryTab === tab ? 'text-brand-contrast' : 'text-neutral-400 hover:text-app-text'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Both stay mounted, toggled via hidden - both call useLiveQuery
            internally, so switching between them as a plain type-swapping
            ternary (React remounts on a component TYPE change regardless
            of key) restarted queries from undefined each time, flashing
            an empty/loading state before real data replaced it. Same fix
            as Settings.jsx/BeginningBalancesPanel.jsx. */}
        <div className={inventoryTab === 'stocks' ? '' : 'hidden'}><HomeStocks /></div>
        <div className={inventoryTab === 'sacks' ? '' : 'hidden'}><HomeSacks /></div>

        <SectionErrorBoundary label="Alerts panel">
          <AlertsPanel />
        </SectionErrorBoundary>
      </div>

      <div key={`activity-${currentWarehouseId}`} className={`stagger-fields animate-flow-down ${pageTab === 'activity' ? '' : 'hidden'}`}>
        {showMillingSection && (
          <SectionErrorBoundary label="Milling monitor">
            <button
              type="button"
              onClick={() => {
                millingToggledByUserRef.current = true
                setShowMillingMonitor((o) => !o)
              }}
              className="mt-4 flex w-full items-center justify-between rounded-2xl border-2 border-brand-amber bg-neutral-900 px-4 py-3 text-left transition-all active:scale-[0.99]"
            >
              <span className="flex items-center gap-2">
                <Factory size={20} className="text-brand-amber" />
                <span className="text-sm font-bold text-app-text">
                  {isRicemillFacility ? 'NFA Ricemill Status' : 'Milling Operations'}
                </span>
              </span>
              {showMillingMonitor ? (
                <ChevronUp size={20} className="text-neutral-500" />
              ) : (
                <ChevronDown size={20} className="text-neutral-500" />
              )}
            </button>
            {shouldRenderMillingMonitor && (
              <div
                className={`mt-3 ${
                  millingToggledByUserRef.current ? (showMillingMonitor ? 'animate-flow-down' : 'animate-flow-up-exit') : ''
                }`}
              >
                {isRicemillFacility ? <NfaMillingMonitor warehouseId={currentWarehouseId} /> : <MillingMonitor />}
              </div>
            )}
          </SectionErrorBoundary>
        )}

        <AuthorityMonitor />
      </div>
    </div>
  )
}

export default Home
