// Navigation gate — Step 3.4. Wraps protected pages and redirects to
// /login if no active AuthContext profile is present. `requireRole`
// (string or array) restricts access to only those roles; `denyRoles`
// (array) blocks specific roles while allowing everyone else - used to
// keep the read-only Visitor role out of Piles/Reports/Settings/Admin
// without needing to enumerate every other role explicitly.

import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'

function ProtectedRoute({ children, requireRole, denyRoles }) {
  const { user } = useAuth()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (requireRole) {
    const allowed = Array.isArray(requireRole) ? requireRole : [requireRole]
    if (!allowed.includes(user.role)) {
      return <Navigate to="/" replace />
    }
  }

  if (denyRoles?.includes(user.role)) {
    return <Navigate to="/" replace />
  }

  return children
}

export default ProtectedRoute
