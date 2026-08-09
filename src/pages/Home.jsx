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
import { Factory, ChevronDown, ChevronUp } from 'lucide-react'
import SectionErrorBoundary from '../components/common/SectionErrorBoundary.jsx'
import ProcurementBagsNotification from '../components/common/ProcurementBagsNotification.jsx'
import PalayDryingStatus from '../components/common/WetPalayNotification.jsx'
import StickyWarehouseIndicator from '../components/common/StickyWarehouseIndicator.jsx'
import HomeStocks from './HomeStocks.jsx'
import HomeSacks from './HomeSacks.jsx'

const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })

function Home() {
  const { user } = useAuth()
  const { accessibleWarehouses, currentWarehouse, currentWarehouseId, setCurrentWarehouseId } =
    useWarehouse() ?? {}
  const { setPageHeader } = usePageHeader() ?? {}
  const hasMillingOrders = (useLiveQuery(() => db.millingOrders.count(), []) ?? 0) > 0

  const [inventoryTab, setInventoryTab] = useState('stocks')
  const [showMillingMonitor, setShowMillingMonitor] = useState(false)
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

      <div key={currentWarehouseId} className="stagger-fields">
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

        {inventoryTab === 'stocks' ? <HomeStocks /> : <HomeSacks />}
      </div>

      <SectionErrorBoundary label="Procurement notification">
        <ProcurementBagsNotification />
      </SectionErrorBoundary>
      <SectionErrorBoundary label="Palay drying status">
        <PalayDryingStatus />
      </SectionErrorBoundary>

      {hasMillingOrders && (
        <SectionErrorBoundary label="Milling monitor">
          <button
            type="button"
            onClick={() => setShowMillingMonitor((o) => !o)}
            className="flex w-full items-center justify-between rounded-2xl border-2 border-brand-amber bg-neutral-900 px-4 py-3 text-left transition-all active:scale-[0.99]"
          >
            <span className="flex items-center gap-2">
              <Factory size={20} className="text-brand-amber" />
              <span className="text-sm font-bold text-app-text">Milling Operations</span>
            </span>
            {showMillingMonitor ? (
              <ChevronUp size={20} className="text-neutral-500" />
            ) : (
              <ChevronDown size={20} className="text-neutral-500" />
            )}
          </button>
          {showMillingMonitor && (
            <div className="mt-3 animate-flow-down">
              <MillingMonitor />
            </div>
          )}
        </SectionErrorBoundary>
      )}

      <AuthorityMonitor />
    </div>
  )
}

export default Home
