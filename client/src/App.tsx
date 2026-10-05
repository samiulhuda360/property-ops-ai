import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Properties from './pages/Properties'
import Tenants from './pages/Tenants'
import Payments from './pages/Payments'
import Maintenance from './pages/Maintenance'
import Inbox from './pages/Inbox'
import Documents from './pages/Documents'
import Reconciliation from './pages/Reconciliation'
import HoursReturned from './pages/HoursReturned'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="properties" element={<Properties />} />
          <Route path="tenants" element={<Tenants />} />
          <Route path="payments" element={<Payments />} />
          <Route path="maintenance" element={<Maintenance />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="documents" element={<Documents />} />
          <Route path="reconciliation" element={<Reconciliation />} />
          <Route path="hours" element={<HoursReturned />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
