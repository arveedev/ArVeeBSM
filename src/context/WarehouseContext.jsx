// Warehouse context — tracks the "currently selected facility" used by
// Home (Step 4.4), and later Piles/Reports. `Admin` users have access to
// every warehouse; other roles are limited to `user.assignedWarehouses`.
// Defaults to the first accessible warehouse once data loads.

import { createContext, useContext, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie.js'
import { useAuth } from './AuthContext.jsx'

const WarehouseContext = createContext(null)

export const WarehouseProvider = ({ children }) => {
  const { user } = useAuth()
  const [currentWarehouseId, setCurrentWarehouseId] = useState('')

  const allWarehouses = useLiveQuery(() => db.warehouses.toArray(), []) ?? []

  const scopedWarehouses =
    user?.role === 'Admin'
      ? allWarehouses
      : allWarehouses.filter((w) => user?.assignedWarehouses?.includes(w.warehouseId))

  // Admin-configurable per-SDO "priority warehouse" (Admin Dashboard >
  // Disbursement > Settings) - explicit request: an SDO assigned to more
  // than one warehouse should always see their priority one first,
  // rather than whatever order db.warehouses happens to return. This is
  // the one place that ordering actually matters everywhere else in the
  // app: it's what picks the default selected warehouse below, and every
  // dropdown/list built from accessibleWarehouses inherits the same
  // order from it.
  const priorityId = user?.priorityWarehouseId
  const accessibleWarehouses = priorityId
    ? [...scopedWarehouses].sort((a, b) => {
        if (a.warehouseId === priorityId) return -1
        if (b.warehouseId === priorityId) return 1
        return 0
      })
    : scopedWarehouses

  const accessibleIds = accessibleWarehouses.map((w) => w.warehouseId).join(',')

  useEffect(() => {
    if (!user) {
      if (currentWarehouseId) setCurrentWarehouseId('')
      return
    }

    const stillAccessible = accessibleWarehouses.some((w) => w.warehouseId === currentWarehouseId)

    if (!stillAccessible && accessibleWarehouses.length > 0) {
      setCurrentWarehouseId(accessibleWarehouses[0].warehouseId)
    } else if (!stillAccessible && accessibleWarehouses.length === 0 && currentWarehouseId) {
      setCurrentWarehouseId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, accessibleIds])

  const currentWarehouse =
    accessibleWarehouses.find((w) => w.warehouseId === currentWarehouseId) ?? null

  const value = {
    accessibleWarehouses,
    currentWarehouseId,
    currentWarehouse,
    setCurrentWarehouseId,
  }

  return <WarehouseContext.Provider value={value}>{children}</WarehouseContext.Provider>
}

export const useWarehouse = () => useContext(WarehouseContext)
