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

  const accessibleWarehouses =
    user?.role === 'Admin'
      ? allWarehouses
      : allWarehouses.filter((w) => user?.assignedWarehouses?.includes(w.warehouseId))

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
