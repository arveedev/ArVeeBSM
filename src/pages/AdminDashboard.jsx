// Admin Dashboard — Step 3.3, revised.
//
// A tabbed configuration panel covering everything the admin manages:
// provinces, warehouses, users, variety types, sack types, and (read-only)
// AI/SIA allocations. Grouped into 4 logical sections, each with its own
// sub-tabs - Structure follows the dependency chain (Provinces -> Branches
// -> Warehouses -> Users), the others are grouped by what they configure.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import ProvincesPanel from '../components/common/admin/ProvincesPanel.jsx'
import BranchesPanel from '../components/common/admin/BranchesPanel.jsx'
import WarehousesPanel from '../components/common/admin/WarehousesPanel.jsx'
import UsersPanel from '../components/common/admin/UsersPanel.jsx'
import VarietyTypesPanel from '../components/common/admin/VarietyTypesPanel.jsx'
import SackTypesPanel from '../components/common/admin/SackTypesPanel.jsx'
import CustomersPanel from '../components/common/admin/CustomersPanel.jsx'
import BeginningBalancesPanel from '../components/common/admin/BeginningBalancesPanel.jsx'
import RicemillAllocationsPanel from '../components/common/admin/RicemillAllocationsPanel.jsx'
import AuthoritiesInfoPanel from '../components/common/admin/AuthoritiesInfoPanel.jsx'
import SignatoriesPanel from '../components/common/admin/SignatoriesPanel.jsx'
import VisitorAccessPanel from '../components/common/admin/VisitorAccessPanel.jsx'
import TransactionTypesPanel from '../components/common/admin/TransactionTypesPanel.jsx'
import SheetSourcesPanel from '../components/common/admin/SheetSourcesPanel.jsx'
import BackupPanel from '../components/common/admin/BackupPanel.jsx'

const GROUPS = [
  {
    id: 'structure',
    label: 'Structure',
    tabs: [
      { id: 'provinces', label: 'Provinces', Panel: ProvincesPanel },
      { id: 'branches', label: 'Branches', Panel: BranchesPanel },
      { id: 'warehouses', label: 'Warehouses', Panel: WarehousesPanel },
      { id: 'users', label: 'Users', Panel: UsersPanel },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    tabs: [
      { id: 'varieties', label: 'Varieties', Panel: VarietyTypesPanel },
      { id: 'sacks', label: 'Sack Types', Panel: SackTypesPanel },
      { id: 'balances', label: 'Beginning Balances', Panel: BeginningBalancesPanel },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    tabs: [
      { id: 'customers', label: 'Customers', Panel: CustomersPanel },
      { id: 'ricemillAllocations', label: 'Miller Allocations', Panel: RicemillAllocationsPanel },
      { id: 'txtypes', label: 'Transaction Types', Panel: TransactionTypesPanel },
      { id: 'authorities', label: 'AI / SIA', Panel: AuthoritiesInfoPanel },
    ],
  },
  {
    id: 'system',
    label: 'System',
    tabs: [
      { id: 'signatories', label: 'Signatories', Panel: SignatoriesPanel },
      { id: 'visitor', label: 'Visitor Access', Panel: VisitorAccessPanel },
      { id: 'sheets', label: 'Sheet Sources', Panel: SheetSourcesPanel },
      { id: 'backup', label: 'Backup', Panel: BackupPanel },
    ],
  },
]

function AdminDashboard() {
  const { setPageHeader } = usePageHeader() ?? {}
  const [activeGroupId, setActiveGroupId] = useState(GROUPS[0].id)
  const activeGroup = GROUPS.find((g) => g.id === activeGroupId) ?? GROUPS[0]
  const activeGroupIndex = GROUPS.indexOf(activeGroup)

  const [activeTabId, setActiveTabId] = useState(activeGroup.tabs[0].id)
  const activeTab = activeGroup.tabs.find((t) => t.id === activeTabId) ?? activeGroup.tabs[0]
  const activeTabIndex = activeGroup.tabs.indexOf(activeTab)
  const ActivePanel = activeTab.Panel

  // Switching groups resets to that group's first tab - the
  // previously active tab id likely doesn't even exist in the new
  // group at all.
  const handleGroupChange = (groupId) => {
    setActiveGroupId(groupId)
    const nextGroup = GROUPS.find((g) => g.id === groupId)
    setActiveTabId(nextGroup.tabs[0].id)
  }

  useEffect(() => {
    setPageHeader?.({
      title: 'Admin Dashboard',
      subtitle: 'Configure provinces, warehouses, users, varieties, and sack types.',
    })
  }, [])

  return (
    <div className="min-h-screen px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-app-text">Admin Dashboard</h1>
          <p className="mt-0.5 text-xs text-neutral-500">Configure provinces, warehouses, users, varieties, and sack types.</p>
        </div>
        <Link
          to="/settings"
          aria-label="Close"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-crimson/40 bg-neutral-900 text-brand-crimson transition-all hover:bg-brand-crimson/10 active:scale-90"
        >
          <X size={20} />
        </Link>
      </div>

      <div className="relative mt-4 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-1">
        <div
          className="absolute inset-y-1 rounded-lg bg-brand-neon transition-transform duration-300 ease-out"
          style={{
            width: `calc(${100 / GROUPS.length}% - ${(GROUPS.length - 1) / GROUPS.length * 0.5}rem)`,
            transform: `translateX(calc(${activeGroupIndex * 100}% + ${activeGroupIndex * 0.5}rem))`,
          }}
        />
        {GROUPS.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => handleGroupChange(group.id)}
            className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              activeGroupId === group.id ? 'text-brand-contrast' : 'text-neutral-400'
            }`}
          >
            {group.label}
          </button>
        ))}
      </div>

      <div key={activeGroupId} className="animate-flow-down">
        <div className="relative mt-3 flex gap-2 overflow-x-auto pb-1">
          {activeGroup.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTabId(tab.id)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-all active:scale-95 ${
                activeTabId === tab.id
                  ? 'bg-brand-neon text-brand-contrast'
                  : 'border border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-600 hover:text-app-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-4 animate-flow-down" key={activeTabId}>
          <ActivePanel />
        </div>
      </div>
    </div>
  )
}

export default AdminDashboard
