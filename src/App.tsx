import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { Protected } from './components/Protected'
import { AbaAtivaProvider } from './contexts/AbaAtivaContext'
import { AuthProvider } from './contexts/AuthContext'
import { ConfirmProvider } from './contexts/ConfirmContext'
import { ToastProvider } from './contexts/ToastContext'
import Login from './pages/Login'

// Lazy loading: cada página vira um chunk separado — o carregamento inicial
// baixa só o essencial (login/estrutura); gráficos e exportação só quando abrir.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Pedidos = lazy(() => import('./pages/Pedidos'))
const PedidoDetalhe = lazy(() => import('./pages/PedidoDetalhe'))
const Arquivo = lazy(() => import('./pages/Arquivo'))
const Estoque = lazy(() => import('./pages/Estoque'))
const Capacidade = lazy(() => import('./pages/Capacidade'))
const Perdas = lazy(() => import('./pages/Perdas'))
const Relatorios = lazy(() => import('./pages/Relatorios'))
const Semana = lazy(() => import('./pages/Semana'))
const MapaCorte = lazy(() => import('./pages/MapaCorte'))
const VisualizarAnexo = lazy(() => import('./pages/VisualizarAnexo'))
const Admin = lazy(() => import('./pages/admin/Admin'))
const Fluxo = lazy(() => import('./pages/admin/Fluxo'))
const Funcionarios = lazy(() => import('./pages/admin/Funcionarios'))
const Sistema = lazy(() => import('./pages/admin/Sistema'))

/** Spinner exibido enquanto o chunk da página é baixado (mesmo padrão visual do app). */
function CarregandoPagina() {
  return (
    <div className="flex justify-center py-20">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
        <AbaAtivaProvider>
          <BrowserRouter>
            <Suspense fallback={<CarregandoPagina />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                {/* Visualizador de anexo em aba própria (sem o menu do app) */}
                <Route
                  path="/anexo/:id"
                  element={
                    <Protected>
                      <VisualizarAnexo />
                    </Protected>
                  }
                />
                <Route
                  element={
                    <Protected>
                      <Layout />
                    </Protected>
                  }
                >
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/pedidos" element={<Pedidos />} />
                  <Route path="/criacao" element={<Pedidos tipo="criacao" />} />
                  <Route path="/canecas" element={<Pedidos tipo="caneca" />} />
                  <Route path="/pedidos/:numero" element={<PedidoDetalhe />} />
                  <Route path="/semana" element={<Semana />} />
                  <Route path="/mapa-corte" element={<MapaCorte />} />
                  <Route path="/arquivo" element={<Arquivo />} />
                  <Route path="/estoque" element={<Estoque />} />
                  <Route path="/capacidade" element={<Capacidade />} />
                  <Route path="/perdas" element={<Perdas />} />
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
                    <Route path="sistema" element={<Sistema />} />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AbaAtivaProvider>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  )
}
