// WarehouseDetailModal — shown when an admin or visitor taps a
// warehouse name on the Dashboard, displaying that warehouse's stock
// and sack data (same view as that warehouse's own Home page) without
// the AI/SIA authority monitor, which is intentionally excluded here
// per explicit request - this is a read-only look at another
// warehouse's inventory, not a place to manage its authorities.

import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useSettings } from '../context/SettingsContext.jsx'
import HomeStocks from './HomeStocks.jsx'
import HomeSacks from './HomeSacks.jsx'

// Must match the transition durations used below.
const SLIDE_MS = 280

function WarehouseDetailModal({ warehouse, onClose }) {
  const [activeTab, setActiveTab] = useState('stocks')
  const { weightUnit, updateSetting } = useSettings() ?? {}
  const isMt = weightUnit === 'mt'

  const [shouldRender, setShouldRender] = useState(Boolean(warehouse))
  const [hasEntered, setHasEntered] = useState(false)
  // Holds onto the most recently opened warehouse so content keeps
  // rendering during the exit slide, even though the warehouse prop
  // itself goes back to null the instant the parent closes it.
  const [displayedWarehouse, setDisplayedWarehouse] = useState(warehouse)

  useEffect(() => {
    if (warehouse) {
      setDisplayedWarehouse(warehouse)
      setShouldRender(true)
    } else {
      setHasEntered(false)
      const timer = setTimeout(() => setShouldRender(false), SLIDE_MS)
      return () => clearTimeout(timer)
    }
  }, [warehouse])

  useEffect(() => {
    if (!shouldRender || !warehouse) return
    const frame = requestAnimationFrame(() => setHasEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [shouldRender, warehouse])

  // The panel covers the full screen with its own internal scroll, but
  // without this the dashboard page behind it is still technically
  // scrollable even though visually hidden - producing two scrollbars
  // side by side.
  useEffect(() => {
    if (!shouldRender) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [shouldRender])

  if (!shouldRender || !displayedWarehouse) return null

  return (
    <>
      {/* Dims whatever portion of the page is still visible while the
          panel slides in/out over it. */}
      <div
        className="fixed inset-0 z-40 bg-black transition-opacity"
        style={{ opacity: hasEntered ? 0.6 : 0, transitionDuration: `${SLIDE_MS}ms` }}
      />
      <div
        style={{
          transform: hasEntered ? 'translateX(0)' : 'translateX(-100%)',
          transition: `transform ${SLIDE_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
        }}
        className="fixed inset-0 z-50 flex flex-col bg-neutral-950"
      >
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-4">
        <div>
          <h1 className="text-lg font-semibold text-app-text">{displayedWarehouse.code} — {displayedWarehouse.name}</h1>
          <p className="text-xs text-neutral-500">Warehouse inventory</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="rounded-full border border-brand-crimson/40 bg-neutral-900 p-2 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90"
          >
            <ArrowLeft size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        <div className="relative flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
          <div
            className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
            style={{ transform: activeTab === 'stocks' ? 'translateX(0%)' : 'translateX(calc(100% + 0.5rem))' }}
          />
          {['stocks', 'sacks'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium capitalize transition-colors active:scale-95 ${
                activeTab === tab ? 'text-brand-contrast' : 'text-neutral-400 hover:text-app-text'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'stocks'
          ? <HomeStocks warehouseId={displayedWarehouse.warehouseId} />
          : <HomeSacks warehouseId={displayedWarehouse.warehouseId} />}
      </div>
      </div>
    </>
  )
}

export default WarehouseDetailModal
