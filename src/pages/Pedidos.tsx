import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import KanbanBoard from '../components/KanbanBoard'
import PedidoFormModal from '../components/PedidoFormModal'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useEtapas } from '../hooks/useEtapas'
import { usePedidos } from '../hooks/usePedidos'
import { supabase } from '../lib/supabase'
import type { Pedido } from '../types'
import { mapaUltrapassagens } from '../utils/fila'
import { formatarData, hojeISO } from '../utils/tempo'

const prioridadeBadge: Record<string, string> = {
  baixa: 'bg-slate-700 text-slate-300',
  normal: 'bg-sky-900 text-sky-300',
  alta: 'bg-amber-900 text-amber-300',
  urgente: 'bg-rose-900 text-rose-300',
}

export default function Pedidos() {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const { pedidos, recarregar } = usePedidos()
  const { etapas, etapasAtivas } = useEtapas()
  const [busca, setBusca] = useState('')
  const [filtroEtapa, setFiltroEtapa] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [modal, setModal] = useState<'novo' | Pedido | null>(null)
  const [visao, setVisao] = useState<'kanban' | 'lista'>(
    () => (localStorage.getItem('pedidos-visao') as 'kanban' | 'lista') ?? 'kanban',
  )

  const trocarVisao = (v: 'kanban' | 'lista') => {
    setVisao(v)
    localStorage.setItem('pedidos-visao', v)
  }

  // pedido.id → quantos pedidos criados depois já passaram na frente
  // (calculado sobre TODOS os pedidos, não só os filtrados)
  const ultrapassagens = useMemo(() => mapaUltrapassagens(pedidos, etapas), [pedidos, etapas])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return pedidos.filter((p) => {
      if (filtroEtapa && p.etapa_atual_id !== filtroEtapa) return false
      if (filtroStatus && p.status !== filtroStatus) return false
      if (!q) return true
      return (
        String(p.numero).includes(q) ||
        p.cliente.toLowerCase().includes(q) ||
        p.descricao.toLowerCase().includes(q)
      )
    })
  }, [pedidos, busca, filtroEtapa, filtroStatus])

  const excluir = async (p: Pedido) => {
    if (!confirm(`Excluir o pedido ${p.numero} (${p.cliente})? O histórico será mantido.`)) return
    const { error } = await supabase.from('pedidos').delete().eq('id', p.id)
    if (error) {
      toast(
        error.message.includes('violates foreign key')
          ? 'Este pedido tem histórico e não pode ser excluído (o histórico nunca é apagado). Você pode cancelá-lo editando o status.'
          : error.message,
        'erro',
      )
    } else {
      toast(`Pedido ${p.numero} excluído.`, 'sucesso')
      recarregar()
    }
  }

  const hoje = hojeISO()
  const inputCls =
    'rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold md:text-2xl">Pedidos</h1>
          <p className="text-sm text-slate-400">{filtrados.length} pedido(s)</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Alternância Kanban / Lista */}
          <div className="flex rounded-lg border border-slate-700 p-0.5">
            <button
              onClick={() => trocarVisao('kanban')}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                visao === 'kanban' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ▦ Kanban
            </button>
            <button
              onClick={() => trocarVisao('lista')}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                visao === 'lista' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ☰ Lista
            </button>
          </div>
          {isAdmin && (
            <button
              onClick={() => setModal('novo')}
              className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500"
            >
              + Novo pedido
            </button>
          )}
        </div>
      </div>

      {/* Busca e filtros */}
      <div className="flex flex-wrap gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por número, cliente…"
          className={`${inputCls} min-w-0 flex-1`}
        />
        <select value={filtroEtapa} onChange={(e) => setFiltroEtapa(e.target.value)} className={inputCls}>
          <option value="">Todas etapas</option>
          {etapasAtivas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </select>
        <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className={inputCls}>
          <option value="">Todos status</option>
          <option value="em_andamento">Em andamento</option>
          <option value="concluido">Concluído</option>
          <option value="cancelado">Cancelado</option>
        </select>
      </div>

      {/* Kanban: arraste os cards entre colunas ou use ⇄ no celular */}
      {visao === 'kanban' && (
        <KanbanBoard
          pedidos={filtrados}
          etapas={etapasAtivas}
          ultrapassagens={ultrapassagens}
          onEditar={isAdmin ? (p) => setModal(p) : undefined}
          onExcluir={isAdmin ? (p) => void excluir(p) : undefined}
        />
      )}

      {/* Lista */}
      {visao === 'lista' && (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtrados.map((p) => {
          const atrasado = p.status === 'em_andamento' && p.data_prevista && p.data_prevista < hoje
          return (
            <div
              key={p.id}
              className={`rounded-xl border bg-slate-900 p-4 transition-colors hover:border-slate-600 ${
                atrasado ? 'border-rose-800' : 'border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <Link to={`/pedidos/${p.numero}`} className="min-w-0">
                  <p className="text-lg font-bold text-sky-400 hover:underline">#{p.numero}</p>
                  <p className="truncate text-sm font-medium">{p.cliente}</p>
                  {p.descricao && <p className="truncate text-xs text-slate-500">{p.descricao}</p>}
                </Link>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${prioridadeBadge[p.prioridade]}`}>
                  {p.prioridade}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {p.status === 'concluido' ? (
                  <span className="rounded-full bg-emerald-900 px-2.5 py-1 font-medium text-emerald-300">
                    ✓ Concluído
                  </span>
                ) : p.status === 'cancelado' ? (
                  <span className="rounded-full bg-slate-800 px-2.5 py-1 font-medium text-slate-400">
                    Cancelado
                  </span>
                ) : (
                  <span
                    className="rounded-full px-2.5 py-1 font-medium"
                    style={{
                      background: `${p.etapa_atual?.cor ?? '#38bdf8'}22`,
                      color: p.etapa_atual?.cor ?? '#38bdf8',
                    }}
                  >
                    {p.etapa_atual?.nome ?? '—'}
                  </span>
                )}
                {atrasado && (
                  <span className="rounded-full bg-rose-900 px-2.5 py-1 font-medium text-rose-300">
                    Atrasado
                  </span>
                )}
                {(ultrapassagens[p.id] ?? 0) > 0 && (
                  <span
                    title={`${ultrapassagens[p.id]} pedido(s) criado(s) depois deste já estão em etapa à frente`}
                    className="rounded-full bg-violet-900 px-2.5 py-1 font-medium text-violet-300"
                  >
                    ⏫ {ultrapassagens[p.id]} na frente
                  </span>
                )}
                {p.data_prevista && (
                  <span className="text-slate-500">Entrega: {formatarData(p.data_prevista)}</span>
                )}
              </div>

              {isAdmin && (
                <div className="mt-3 flex gap-2 border-t border-slate-800 pt-3 text-xs">
                  <button onClick={() => setModal(p)} className="text-slate-400 hover:text-sky-400">
                    Editar
                  </button>
                  <button onClick={() => void excluir(p)} className="text-slate-400 hover:text-rose-400">
                    Excluir
                  </button>
                </div>
              )}
            </div>
          )
        })}
        {filtrados.length === 0 && (
          <p className="col-span-full py-16 text-center text-sm text-slate-500">
            Nenhum pedido encontrado.
          </p>
        )}
      </div>
      )}

      {modal && (
        <PedidoFormModal
          pedido={modal === 'novo' ? null : modal}
          onFechar={() => setModal(null)}
          onSalvo={recarregar}
        />
      )}
    </div>
  )
}
