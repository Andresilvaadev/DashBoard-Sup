import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { Protected } from './components/Protected'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import PedidoDetalhe from './pages/PedidoDetalhe'
import Pedidos from './pages/Pedidos'
import Relatorios from './pages/Relatorios'
import Admin from './pages/admin/Admin'
import Fluxo from './pages/admin/Fluxo'
import Funcionarios from './pages/admin/Funcionarios'
import Metas from './pages/admin/Metas'

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <Protected>
                  <Layout />
                </Protected>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/pedidos" element={<Pedidos />} />
              <Route path="/pedidos/:numero" element={<PedidoDetalhe />} />
              <Route path="/relatorios" element={<Relatorios />} />
              <Route
                path="/admin"
                element={
                  <Protected somenteAdmin>
                    <Admin />
                  </Protected>
                }
              >
                <Route index element={<Funcionarios />} />
                <Route path="fluxo" element={<Fluxo />} />
                <Route path="metas" element={<Metas />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
