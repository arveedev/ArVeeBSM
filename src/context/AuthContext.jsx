// Authorization context — PIN-based authentication against the local Dexie
// `users` table. Implements Step 3.2.
//
// The active profile is held in React state only ("securely in memory" per
// the PRDD) — it is intentionally NOT persisted to storage, so each fresh
// page load requires re-entering the PIN.

import { createContext, useContext, useState } from 'react'
import toast from 'react-hot-toast'
import { db } from '../db/dexie.js'
import { hashPin, hashPinLegacyUnsalted } from '../utils/pinHash.js'
import { preloadTransactionsForUser } from '../services/transactionPreload.js'
import { SyncProgressToast } from '../components/common/AnimatedToast.jsx'

const AuthContext = createContext(null)

// Fire-and-forget wrapper around preloadTransactionsForUser - login
// itself must never wait on this, since preload can take a while for a
// warehouse's first-ever pull. A single toast (fixed id, updates in
// place rather than stacking a new one per warehouse/type step) gives
// lightweight visibility without being intrusive. Any failure is
// swallowed here (already logged to the console by the underlying
// fetch functions) - the app must keep working normally either way,
// since preload is a performance optimization, not a requirement.
const runPreloadWithFeedback = async (user) => {
  const toastId = 'transaction-preload'
  // Never lets the notification linger indefinitely, even if preload
  // itself is taking unusually long or its promise never resolves for
  // any reason - the background work continues completely unaffected
  // either way, since this only ever hides the toast, never cancels
  // anything.
  const timeoutId = setTimeout(() => toast.dismiss(toastId), 20000)
  try {
    await preloadTransactionsForUser(user, {
      // Toast #2 (picked) - same progress-toast component used for the
      // GitHub backup and Sheets "Sync Now", so this reads as the same
      // kind of event instead of a plain, unstyled loading line.
      onProgress: ({ type, warehouseCount }) => {
        toast.loading(
          <SyncProgressToast
            label={`Preparing ${type} data for ${warehouseCount} warehouse${warehouseCount === 1 ? '' : 's'}…`}
            phase="progress"
          />,
          { id: toastId }
        )
      },
    })
    // A real "done" state (briefly, via the same component), not just
    // a silent dismiss - login preload finishing is exactly the kind
    // of meaningful sync event toast #2 was picked for.
    toast.success(<SyncProgressToast doneLabel="Data ready" phase="done" />, { id: toastId, duration: 1400 })
  } catch (err) {
    console.error('Transaction preload failed:', err)
    toast.dismiss(toastId)
  } finally {
    clearTimeout(timeoutId)
  }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)

  /**
   * Validate a 6-digit access code against the local `users` table.
   * Returns the matching user record on success, or null on failure.
   * If no real user matches, also checks the global visitor access code
   * (admin-configured) - a match creates a synthetic, view-only session
   * with no uid/warehouse, since a visitor isn't a real staff account.
   *
   * PINs are never stored or compared in plain text - both accessCode
   * (per user) and visitorAccessCode (global) are stored as SHA-256
   * hashes, so the entered PIN is hashed here before every lookup.
   */
  const login = async (accessCode) => {
    const hashedInput = await hashPin(accessCode)

    // TEMPORARY DIAGNOSTIC LOGGING - see matching note in db/dexie.js.
    // Remove once the Dexie Cloud connection is confirmed stable.
    try {
      const totalUsers = await db.users.count()
      console.log(`[DEXIE-CLOUD-DIAGNOSTIC] login attempt - users table has ${totalUsers} total record(s)`)
    } catch (err) {
      console.log('[DEXIE-CLOUD-DIAGNOSTIC] login attempt - ERROR counting users table:', err.message)
    }

    let match
    try {
      match = await db.users.where('accessCode').equals(hashedInput).first()
      console.log('[DEXIE-CLOUD-DIAGNOSTIC] login query result:', match ? `matched uid ${match.uid}` : 'no match found')
    } catch (err) {
      console.log('[DEXIE-CLOUD-DIAGNOSTIC] login query THREW an error:', err.message, err.stack)
      throw err
    }

    // No match against the salted hash - the account may predate PIN
    // salting (see pinHash.js). Check the old unsalted form; if it
    // matches, this genuinely is the right PIN, so upgrade the stored
    // hash to the salted form now while the real PIN is in hand (a
    // hash can never be migrated without it). Silent and one-time per
    // account - every later login already matches on the first try.
    if (!match) {
      const legacyHash = await hashPinLegacyUnsalted(accessCode)
      const legacyMatch = await db.users.where('accessCode').equals(legacyHash).first()
      if (legacyMatch) {
        await db.users.update(legacyMatch.uid, { accessCode: hashedInput })
        match = { ...legacyMatch, accessCode: hashedInput }
      }
    }

    if (match) {
      setUser(match)
      runPreloadWithFeedback(match)
      return match
    }

    const config = await db.reportConfig.get('global')
    if (config?.visitorAccessCode) {
      if (hashedInput === config.visitorAccessCode) {
        const visitorUser = { role: 'Visitor', nickname: 'Visitor', name: 'Visitor' }
        setUser(visitorUser)
        return visitorUser
      }
      const legacyVisitorHash = await hashPinLegacyUnsalted(accessCode)
      if (legacyVisitorHash === config.visitorAccessCode) {
        await db.reportConfig.update('global', { visitorAccessCode: hashedInput })
        const visitorUser = { role: 'Visitor', nickname: 'Visitor', name: 'Visitor' }
        setUser(visitorUser)
        return visitorUser
      }
    }

    return null
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
