// Navigation gate — Step 3.4. Wraps protected pages and redirects to
// /login if no active AuthContext profile is present. An optional
// `requireRole` prop further restricts access (e.g. the Admin Dashboard).

import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'

function ProtectedRoute({ children, requireRole }) {
  const { user } = useAuth()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (requireRole && user.role !== requireRole) {
    return <Navigate to="/" replace />
  }

  return children
}

export default ProtectedRoute
