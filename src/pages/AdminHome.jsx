// Admin Home - executive summary across ALL warehouses.
// Thin container: tab state only, delegates to AdminHomeStocks/AdminHomeSacks.

import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import AdminHomeStocks from './AdminHomeStocks.jsx'
import AdminHomeSacks from './AdminHomeSacks.jsx'
import WarehouseDetailModal from './WarehouseDetailModal.jsx'


function AdminHome() {
  const { user } = useAuth()
  const { setPageHeader } = usePageHeader() ?? {}
  const [activeTab, setActiveTab] = useState('stocks')
  const [selectedWarehouse, setSelectedWarehouse] = useState(null)
  const [selectedWarehouseTab, setSelectedWarehouseTab] = useState('stocks')

  // Tapping a warehouse from the Sacks tab should open its detail view
  // already on Sacks, not always default back to Stocks - the admin
  // just told the app which one they care about by which tab they were on.
  const handleWarehouseSelect = (warehouse) => {
    setSelectedWarehouseTab(activeTab)
    setSelectedWarehouse(warehouse)
  }

  useEffect(() => {
    setPageHeader?.({ title: 'Dashboard', subtitle: `Welcome back, ${user?.nickname ?? ''}.` })
  }, [user?.nickname])

  return (
    <div className="min-h-screen px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6">
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

      <div key={activeTab} className="animate-flow-down">
        {activeTab === 'stocks'
          ? <AdminHomeStocks onWarehouseSelect={handleWarehouseSelect} />
          : <AdminHomeSacks onWarehouseSelect={handleWarehouseSelect} />}
      </div>

      <WarehouseDetailModal warehouse={selectedWarehouse} initialTab={selectedWarehouseTab} onClose={() => setSelectedWarehouse(null)} />
    </div>
  )
}

export default AdminHome
