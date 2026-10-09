// Who sees which Inventory Reports screen. An Admin always sees every screen; for a
// Visitor each screen is either shared or Admin only, set by an Admin in the Admin
// Dashboard (Report Access) and stored on the shared reportConfig record as
// `inventoryReportsAccess: { [screenId]: 'visitor' | 'admin' }`. A screen with no saved
// choice uses DEFAULT_ACCESS. This only decides what is shown; nothing is changed.

export const REPORT_SCREENS = [
  { id: 'ledger', name: 'Daily inventory' },
  { id: 'summary', name: 'Summary' },
  { id: 'age', name: 'Age monitoring' },
  { id: 'ending', name: 'Ending stock per variety' },
  { id: 'procurement', name: 'Daily procurement status' },
  { id: 'milling', name: 'Milling liquidation' },
  { id: 'test', name: 'Test milling liquidation' },
  { id: 'check', name: 'Data check' },
]

// Data check lists data problems, so it starts as Admin only; everything else is shared.
export const DEFAULT_ACCESS = { check: 'admin' }

export const reportAccessOf = (id, access) => access?.[id] ?? DEFAULT_ACCESS[id] ?? 'visitor'

export const canViewReport = (id, isAdmin, access) => isAdmin || reportAccessOf(id, access) === 'visitor'
