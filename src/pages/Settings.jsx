// Settings — client configuration toggles, session profile, and logout.

import { useNavigate, Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../context/AuthContext.jsx'
import { useSettings } from '../context/SettingsContext.jsx'
import { db } from '../db/dexie.js'

function Toggle({ label, description, value, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="mt-0.5 text-xs text-neutral-500">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        aria-pressed={value}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          value ? 'bg-brand-neon' : 'bg-neutral-700'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-neutral-950 shadow transition-transform ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

function Settings() {
  const { user, logout } = useAuth()
  const { autoAgeMonitoring, updateSetting } = useSettings() ?? {}
  const navigate = useNavigate()

  const warehouses = useLiveQuery(async () => {
    if (user?.role === 'Admin') return db.warehouses.toArray()
    if (!user?.assignedWarehouses?.length) return []
    return db.warehouses.bulkGet(user.assignedWarehouses)
  }, [user?.role, user?.assignedWarehouses])

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const warehouseLabel =
    user?.role === 'Admin'
      ? 'All Warehouses'
      : (warehouses ?? [])
          .filter(Boolean)
          .map((w) => w.code)
          .join(', ') || 'No warehouse assigned'

  return (
    <div className="min-h-screen px-4 pb-24 pt-6">
      <h1 className="text-xl font-semibold text-white">Settings</h1>

      {user && (
        <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-sm font-medium text-white">
            {user.nickname} · {user.role}
          </p>
          <p className="text-xs text-neutral-400">{user.name}</p>
          <p className="text-xs text-neutral-400">{warehouseLabel}</p>
        </div>
      )}

      <div className="mt-6 space-y-3">
        <h2 className="text-sm font-semibold text-white">Preferences</h2>

        <Toggle
          label="Auto Age Monitoring"
          description="Automatically calculates pile age from the date of receipt. When off, the displayed age stays at the manually set value until you edit it directly on the pile."
          value={autoAgeMonitoring ?? true}
          onChange={(val) => updateSetting?.('autoAgeMonitoring', val)}
        />
      </div>

      {user?.role === 'Admin' && (
        <Link
          to="/admin"
          className="mt-6 block rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-center text-sm font-medium text-brand-neon"
        >
          Admin Dashboard
        </Link>
      )}

      <button
        type="button"
        onClick={handleLogout}
        className="mt-3 w-full rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm font-medium text-brand-crimson"
      >
        Logout
      </button>
    </div>
  )
}

export default Settings
