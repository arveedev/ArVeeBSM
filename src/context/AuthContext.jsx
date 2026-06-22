// Authorization context — PIN-based authentication against the local Dexie
// `users` table. Implements Step 3.2.
//
// The active profile is held in React state only ("securely in memory" per
// the PRDD) — it is intentionally NOT persisted to storage, so each fresh
// page load requires re-entering the PIN.

import { createContext, useContext, useState } from 'react'
import { db } from '../db/dexie.js'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)

  /**
   * Validate a 6-digit access code against the local `users` table.
   * Returns the matching user record on success, or null on failure.
   */
  const login = async (accessCode) => {
    const match = await db.users.where('accessCode').equals(accessCode).first()

    if (!match) return null

    setUser(match)
    return match
  }

  const logout = () => setUser(null)

  const value = {
    user,
    login,
    logout,
    isAuthenticated: !!user,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
