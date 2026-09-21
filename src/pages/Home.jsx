// Home - Dynamic Facility Status Core Overview (Step 4.4).
// Thin container: warehouse selector, inventory tab state, delegates to
// HomeStocks/HomeSacks. The pile list moved to its own tab on the Piles
// page (alongside the layout editor) - it no longer lives on Home.

import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useWarehouse } from '../context/WarehouseContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import AuthorityMonitor from '../components/common/AuthorityMonitor.jsx'
import MillingMonitor from '../components/common/MillingMonitor.jsx'
import NfaMillingMonitor from '../components/common/NfaMillingMonitor.jsx'
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
  // Monitor. Splitting these into two top-level tabs, rather than
  // stacking everything on one screen, mirrors the same Summary/Stock
  // Statement split just added to Reports.jsx.
  const [pageTab, setPageTab] = useState('overview')
  const [inventoryTab, setInventoryTab] = useState('stocks')
  // Per explicit request, Authority Monitor and Milling Operations are
  // now their own mutually-exclusive sub-tabs within Activity (previously
  // stacked - Milling collapsible, Authority always shown below it).
  // Defaults to 'authority' since it's relevant to every warehouse,
  // unlike Milling which only applies when showMillingSection is true.
  const [activitySubTab, setActivitySubTab] = useState('authority')
  // Both live here in the parent, above the key={currentWarehouseId}
  // remount boundary on the panels below - so without this, switching
  // warehouses left the previous warehouse's tab selected for the new
  // one too, since nothing was actually telling it to reset back to
  // the default.
  useEffect(() => {
    setInventoryTab('stocks')
    setActivitySubTab('authority')
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
            className={`relative z-10 flex-1 rounded-lg py-2 text-base transition-all active:scale-95 ${
              pageTab === t.id ? 'font-extrabold text-brand-contrast' : 'font-semibold text-neutral-400 hover:text-app-text'
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
              className={`relative z-10 flex-1 rounded-lg py-2 text-base capitalize transition-colors active:scale-95 ${
                inventoryTab === tab ? 'font-bold text-brand-contrast' : 'font-medium text-neutral-400 hover:text-app-text'
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
        <div className={inventoryTab === 'stocks' ? '' : 'hidden'}>
          {/* active - HomeStocks stays mounted while hidden (see this
              block's own comment above), so its per-variety age-group
              expand/collapse state would otherwise silently persist
              across tab switches. Passed down so it can reset that
              state the moment this tab stops being the visible one. */}
          <HomeStocks active={pageTab === 'overview' && inventoryTab === 'stocks'} />
        </div>
        <div className={inventoryTab === 'sacks' ? '' : 'hidden'}><HomeSacks /></div>

        <SectionErrorBoundary user={user} label="Alerts panel">
          <AlertsPanel />
        </SectionErrorBoundary>
      </div>

      <div key={`activity-${currentWarehouseId}`} className={`stagger-fields animate-flow-down ${pageTab === 'activity' ? '' : 'hidden'}`}>
        {/* A warehouse with no milling activity has nothing to switch
            between, so the sub-tab bar itself only appears once there's
            a second thing to show - Authority Monitor alone otherwise. */}
        {showMillingSection && (
          <div className="relative mt-1 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
            <div
              className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
              style={{ transform: activitySubTab === 'authority' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
            />
            {[
              { id: 'authority', label: 'Authority' },
              { id: 'milling', label: isRicemillFacility ? 'NFA Ricemill' : 'Milling' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActivitySubTab(t.id)}
                className={`relative z-10 flex-1 rounded-lg py-2 text-base transition-all active:scale-95 ${
                  activitySubTab === t.id ? 'font-extrabold text-brand-contrast' : 'font-semibold text-neutral-400 hover:text-app-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className={`mt-4 ${!showMillingSection || activitySubTab === 'authority' ? '' : 'hidden'}`}>
          <AuthorityMonitor />
        </div>

        {showMillingSection && (
          <SectionErrorBoundary user={user} label="Milling monitor">
            <div className={`mt-4 ${activitySubTab === 'milling' ? '' : 'hidden'}`}>
              {isRicemillFacility ? <NfaMillingMonitor warehouseId={currentWarehouseId} /> : <MillingMonitor />}
            </div>
          </SectionErrorBoundary>
        )}
      </div>
    </div>
  )
}

export default Home
