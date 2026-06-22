import { useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Toaster, toast } from 'react-hot-toast'
import Login from './pages/Login.jsx'
import Home from './pages/Home.jsx'
import AdminHome from './pages/AdminHome.jsx'
import Piles from './pages/Piles.jsx'
import AdminMonitoring from './pages/AdminMonitoring.jsx'
import Reports from './pages/Reports.jsx'
import Settings from './pages/Settings.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import ProtectedRoute from './components/common/ProtectedRoute.jsx'
import BottomNav from './components/layout/BottomNav.jsx'
import TransactionModal from './components/common/TransactionModal.jsx'
import WSRForm from './components/forms/WSRForm.jsx'
import WSIForm from './components/forms/WSIForm.jsx'
import WTSForm from './components/forms/WTSForm.jsx'
import ESIForm from './components/forms/ESIForm.jsx'
import ESRForm from './components/forms/ESRForm.jsx'
import { useAuth } from './context/AuthContext.jsx'
import { startSyncWorker, startAuthoritySyncWorker } from './services/syncWorker.js'

const FORM_COMPONENTS = {
  WSR: WSRForm,
  WSI: WSIForm,
  WTS: WTSForm,
  ESI: ESIForm,
  ESR: ESRForm,
}

function App() {
  const { user } = useAuth()
  const [isTransactionModalOpen, setTransactionModalOpen] = useState(false)
  const [activeFormType, setActiveFormType] = useState(null)
  const [activeFormPrefill, setActiveFormPrefill] = useState(null)

  const isAdmin = user?.role === 'Admin'

  const openForm = (type, prefill = null) => {
    setActiveFormType(type)
    setActiveFormPrefill(prefill)
  }

  const closeForm = () => {
    setActiveFormType(null)
    setActiveFormPrefill(null)
  }

  // Exposed so any page (e.g. an AI/SIA monitoring panel) can deep-link
  // straight into a transaction form pre-filled from an authority record,
  // without needing prop-drilling through every route.
  useEffect(() => {
    window.openTransactionForm = openForm
    return () => {
      delete window.openTransactionForm
    }
  }, [])

  useEffect(() => {
    const cleanup = startSyncWorker((result) => {
      if (result.synced > 0) {
        toast.success(`Synced ${result.synced} record${result.synced === 1 ? '' : 's'} to cloud`)
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} record${result.failed === 1 ? '' : 's'} failed to sync`)
      }
    })

    return cleanup
  }, [])

  // AI/SIA retrieval (Phase 6) only makes sense once a user is logged in
  // (db.warehouses/varietyTypes/sackTypes lookups assume a configured
  // tenant) — runs once on login, then periodically + on reconnect.
  useEffect(() => {
    if (!user) return
    return startAuthoritySyncWorker()
  }, [user])

  return (
    <div className="min-h-screen bg-neutral-950">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              {isAdmin ? <AdminHome /> : <Home />}
            </ProtectedRoute>
          }
        />
        <Route
          path="/piles"
          element={
            <ProtectedRoute>
              <Piles />
            </ProtectedRoute>
          }
        />
        <Route
          path="/monitoring"
          element={
            <ProtectedRoute requireRole="Admin">
              <AdminMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireRole="Admin">
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
      </Routes>

      {user && (
        <>
          <BottomNav onFabClick={() => setTransactionModalOpen(true)} />
          <TransactionModal
            open={isTransactionModalOpen}
            onClose={() => setTransactionModalOpen(false)}
            onSelectType={(type) => openForm(type)}
          />
          {activeFormType &&
            (() => {
              const FormComponent = FORM_COMPONENTS[activeFormType]
              return (
                <FormComponent onClose={closeForm} prefill={activeFormPrefill} />
              )
            })()}
        </>
      )}

      {/* Global notification layer — replaces alert()/confirm() per Section 2.3 */}
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: '#171717',
            color: '#FFFFFF',
            border: '1px solid #262626',
          },
        }}
      />
    </div>
  )
}

export default App
