// Admin Dashboard — Step 3.3, revised.
//
// A tabbed configuration panel covering everything the admin manages:
// provinces, warehouses, users, variety types, sack types, and (read-only)
// AI/SIA allocations. Tabs are ordered to follow the dependency chain —
// Provinces -> Warehouses -> Users.

import { useEffect, useState } from 'react'
import { usePageHeader } from '../context/PageHeaderContext.jsx'
import ProvincesPanel from '../components/common/admin/ProvincesPanel.jsx'
import BranchesPanel from '../components/common/admin/BranchesPanel.jsx'
import WarehousesPanel from '../components/common/admin/WarehousesPanel.jsx'
import UsersPanel from '../components/common/admin/UsersPanel.jsx'
import VarietyTypesPanel from '../components/common/admin/VarietyTypesPanel.jsx'
import SackTypesPanel from '../components/common/admin/SackTypesPanel.jsx'
import AuthoritiesInfoPanel from '../components/common/admin/AuthoritiesInfoPanel.jsx'
import SignatoriesPanel from '../components/common/admin/SignatoriesPanel.jsx'
import VisitorAccessPanel from '../components/common/admin/VisitorAccessPanel.jsx'
import TransactionTypesPanel from '../components/common/admin/TransactionTypesPanel.jsx'
import SheetSourcesPanel from '../components/common/admin/SheetSourcesPanel.jsx'
import BackupPanel from '../components/common/admin/BackupPanel.jsx'

const TABS = [
  { id: 'provinces', label: 'Provinces', Panel: ProvincesPanel },
  { id: 'branches', label: 'Branches', Panel: BranchesPanel },
  { id: 'warehouses', label: 'Warehouses', Panel: WarehousesPanel },
  { id: 'users', label: 'Users', Panel: UsersPanel },
  { id: 'varieties', label: 'Varieties', Panel: VarietyTypesPanel },
  { id: 'sacks', label: 'Sack Types', Panel: SackTypesPanel },
  { id: 'txtypes', label: 'Transaction Types', Panel: TransactionTypesPanel },
  { id: 'authorities', label: 'AI / SIA', Panel: AuthoritiesInfoPanel },
  { id: 'signatories', label: 'Signatories', Panel: SignatoriesPanel },
  { id: 'visitor', label: 'Visitor Access', Panel: VisitorAccessPanel },
  { id: 'sheets', label: 'Sheet Sources', Panel: SheetSourcesPanel },
  { id: 'backup', label: 'Backup', Panel: BackupPanel },
]

function AdminDashboard() {
  const { setPageHeader } = usePageHeader() ?? {}
  const [activeTab, setActiveTab] = useState('provinces')
  const active = TABS.find((t) => t.id === activeTab) ?? TABS[0]
  const ActivePanel = active.Panel

  useEffect(() => {
    setPageHeader?.({
      title: 'Admin Dashboard',
      subtitle: 'Configure provinces, warehouses, users, varieties, and sack types.',
    })
  }, [])

  return (
    <div className="min-h-screen px-4 pb-24 pt-6">
      <div className="flex gap-2 overflow-x-auto pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-all active:scale-95 ${
              activeTab === tab.id
                ? 'bg-brand-neon text-brand-contrast'
                : 'border border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-600 hover:text-app-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <ActivePanel />
      </div>
    </div>
  )
}

export default AdminDashboard
