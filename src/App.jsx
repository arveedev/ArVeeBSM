import { useEffect, useRef, useState } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
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
import SectionErrorBoundary from './components/common/SectionErrorBoundary.jsx'
import BottomNav, { REGULAR_NAV_COLUMN } from './components/layout/BottomNav.jsx'
import AppHeader from './components/layout/AppHeader.jsx'
import { useSettings } from './context/SettingsContext.jsx'
import TransactionModal from './components/common/TransactionModal.jsx'
import WSRForm from './components/forms/WSRForm.jsx'
import WSIForm from './components/forms/WSIForm.jsx'
import WTSForm from './components/forms/WTSForm.jsx'
import ESIForm from './components/forms/ESIForm.jsx'
import ESRForm from './components/forms/ESRForm.jsx'
import { useAuth } from './context/AuthContext.jsx'
import { usePageHeader } from './context/PageHeaderContext.jsx'
import { startSyncWorker, startAuthoritySyncWorker, startTransactionSyncWorker, registerImmediateSyncOnSave } from './services/syncWorker.js'
import AnimatedToast from './components/common/AnimatedToast.jsx'
import useDelayedUnmount from './hooks/useDelayedUnmount.js'

// Must match the form's own pop-out exit transition duration (see
// StockFormBase/SackFormBase/WTSForm) - keeps the form mounted long
// enough after activeFormType clears for its exit animation to finish
// playing, instead of it vanishing mid-transition.
const FORM_EXIT_MS = 350

const FORM_COMPONENTS = {
  WSR: WSRForm,
  WSI: WSIForm,
  WTS: WTSForm,
  ESI: ESIForm,
  ESR: ESRForm,
}

function App() {
  const { user } = useAuth()
  const { theme } = useSettings() ?? {}
  const { chromeHidden } = usePageHeader() ?? {}
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [isTransactionModalOpen, setTransactionModalOpen] = useState(false)
  const [activeFormType, setActiveFormType] = useState(null)
  // Admin Dashboard closes the same way the transaction forms do: tapping
  // its own X starts its pop-out immediately (and this flag flips true
  // right away, so the header/nav bars start sliding back into view in
  // the same instant) while the actual route change - which is what
  // really unmounts the page - is deferred by ADMIN_EXIT_MS so that
  // pop-out has time to finish playing first.
  const [adminClosing, setAdminClosing] = useState(false)
  useEffect(() => {
    if (pathname !== '/admin') setAdminClosing(false)
  }, [pathname])
  const closeAdminDashboard = () => {
    setAdminClosing(true)
    setTimeout(() => navigate('/settings'), FORM_EXIT_MS)
  }
  const barsHidden = Boolean(activeFormType) || (pathname === '/admin' && !adminClosing) || Boolean(chromeHidden)
  // Tracks the previous pathname's nav column, to compute page-slide
  // direction on every route change - "forward" (deeper into the app,
  // e.g. Home to Piles) enters from the right, "back" (returning
  // toward Home) enters from the left. Falls back to "forward" for any
  // route pair not part of the bottom nav (e.g. /admin), since there
  // is no meaningful column-based direction to compute there.
  const previousColumnRef = useRef(REGULAR_NAV_COLUMN[pathname] ?? 0)
  const [pageDirection, setPageDirection] = useState('forward')
  useEffect(() => {
    const currentColumn = REGULAR_NAV_COLUMN[pathname]
    const previousColumn = previousColumnRef.current
    if (currentColumn != null && previousColumn != null) {
      setPageDirection(currentColumn >= previousColumn ? 'forward' : 'back')
    } else {
      setPageDirection('forward')
    }
    previousColumnRef.current = currentColumn ?? previousColumn
  }, [pathname])
  // Kept mounted for FORM_EXIT_MS after activeFormType clears, so the
  // form's own pop-out exit transition has time to actually play -
  // otherwise it would vanish the instant the close button is tapped,
  // since activeFormType (and thus this conditional render) now clears
  // immediately rather than waiting for the form's local animation.
  const shouldRenderForm = useDelayedUnmount(Boolean(activeFormType), FORM_EXIT_MS)
  // activeFormType itself goes null immediately on close (so the header/
  // nav bars start sliding back into view right away), but the form
  // component still needs to know which one to keep rendering during
  // that trailing exit window - this remembers the last non-null value.
  const lastFormTypeRef = useRef(null)
  if (activeFormType) lastFormTypeRef.current = activeFormType
  const formTypeToRender = activeFormType ?? lastFormTypeRef.current

  // The form itself covers the full screen (fixed inset-0), but without
  // this the page behind it is still technically scrollable even though
  // visually hidden - producing two scrollbars side by side on desktop
  // (the form's own internal scroll, and the underlying page's).
  useEffect(() => {
    document.body.style.overflow = shouldRenderForm ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [shouldRenderForm])
  const [activeFormPrefill, setActiveFormPrefill] = useState(null)

  const isAdmin = user?.role === 'Admin'
  const isVisitor = user?.role === 'Visitor'

  // Theme defaults to dark (no .light class) - only toggled on when the
  // persisted preference explicitly says 'light'.
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  // Always start a newly-navigated-to page at the top, rather than
  // carrying over whatever scroll position the previous page was left
  // at - e.g. switching from a long scrolled-down list to a different
  // tab shouldn't land the user mid-page on the new one.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  const openForm = (type, prefill = null) => {
    setActiveFormType(type)
    setActiveFormPrefill(prefill)
  }

  const closeForm = () => {
    setActiveFormType(null)
  }

  // Prefill data stays around through the trailing exit-animation window
  // (the form itself doesn't need it updated after its initial load) and
  // is only cleared once the form has actually finished unmounting.
  useEffect(() => {
    if (!shouldRenderForm) setActiveFormPrefill(null)
  }, [shouldRenderForm])

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
    registerImmediateSyncOnSave()

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

  // Transaction data (WSR/WSI/ESR/ESI) - same shape as above, but on a
  // much shorter 30-second interval, since keeping this current is
  // what the duplicate-series check depends on. Previously only ran
  // once at login via AuthContext's own call, with nothing repeating
  // it afterward.
  useEffect(() => {
    if (!user) return
    return startTransactionSyncWorker(user)
  }, [user])

  return (
    <div className={`min-h-screen bg-neutral-950 ${pathname !== '/login' ? 'animate-app-fade-in' : ''}`}>
      {/* Stays mounted even while a transaction form (or the Admin
          Dashboard, which uses the same fixed-overlay/pop treatment) is
          open - previously unmounted outright via !activeFormType/
          pathname==='/admin' - so it can slide away instead of just
          vanishing - see AppHeader's own comment. */}
      {user && pathname !== '/login' && <AppHeader hidden={barsHidden} />}
      {/* No page-slide for /admin - it's a fixed-position overlay with
          its own pop transition (see AdminDashboard.jsx), and a
          transform applied by this wrapper would become its containing
          block, dragging the "fixed" overlay along with the slide
          instead of leaving it pinned to the real viewport. */}
      <div key={pathname !== '/login' ? pathname : 'login'} className={pathname !== '/login' && pathname !== '/admin' ? (pageDirection === 'back' ? 'animate-page-back' : 'animate-page-forward') : ''}>
        <Routes>
          <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              {isAdmin || isVisitor ? <AdminHome /> : <Home />}
            </ProtectedRoute>
          }
        />
        <Route
          path="/piles"
          element={
            <ProtectedRoute denyRoles={['Visitor']}>
              <Piles />
            </ProtectedRoute>
          }
        />
        <Route
          path="/monitoring"
          element={
            <ProtectedRoute requireRole={['Admin', 'Visitor']}>
              <AdminMonitoring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute denyRoles={['Visitor']}>
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute denyRoles={['Visitor']}>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireRole="Admin">
              <AdminDashboard onClose={closeAdminDashboard} />
            </ProtectedRoute>
          }
        />
      </Routes>
      </div>

      {user && pathname !== '/login' && (
        <>
          <BottomNav onFabClick={() => setTransactionModalOpen(true)} hidden={barsHidden} />
          {!isVisitor && pathname !== '/admin' && (
            <>
              <TransactionModal
                open={isTransactionModalOpen}
                onClose={() => setTransactionModalOpen(false)}
                onSelectType={(type) => openForm(type)}
              />
              {shouldRenderForm &&
                (() => {
                  const FormComponent = FORM_COMPONENTS[formTypeToRender]
                  return (
                    <SectionErrorBoundary label={`${formTypeToRender} form`} onClose={closeForm}>
                      <FormComponent isOpen={Boolean(activeFormType)} onClose={closeForm} prefill={activeFormPrefill} />
                    </SectionErrorBoundary>
                  )
                })()}
            </>
          )}
        </>
      )}

      {/* Global notification layer — replaces alert()/confirm() per Section 2.3.
          Custom-rendered via AnimatedToast (icon per type, entrance motion,
          swipe-to-dismiss) - every existing toast.success/error/etc call
          site is untouched, this hooks in once at the Toaster level. */}
      <Toaster position="top-center">
        {(t) => <AnimatedToast t={t} />}
      </Toaster>
    </div>
  )
}

export default App
