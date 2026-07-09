import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePedidos } from '../hooks/usePedidos'
import { formatarDataHora } from '../utils/tempo'

type Filtro = 'concluido' | 'arquivado' | 'cancelado' | 'todos'

const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'concluido', label: 'Concluídos' },
  { id: 'arquivado', label: 'Arquivados' },
  { id: 'cancelado', label: 'Cancelados' },
  { id: 'todos', label: 'Todos' },
]

const ARQUIVAVEL = ['concluido', 'arquivado', 'cancelado']

/**
 * Arquivo: pedidos que saíram do fluxo (concluídos e cancelados). Mantém
 * o histórico acessível sem poluir o quadro do dia a dia. Não carrega as
 * fotos aqui de propósito, para economizar banda — elas ficam na tela do pedido.
 */
export default function Arquivo() {
  const { pedidos } = usePedidos()
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('concluido')

  const arquivados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return pedidos
      .filter((p) => {
        if (!ARQUIVAVEL.includes(p.status)) return false
        if (filtro !== 'todos' && p.status !== filtro) return false
        if (!q) return true
        return (
          String(p.numero).includes(q) ||
          p.cliente.toLowerCase().includes(q) ||
          p.descricao.toLowerCase().includes(q)
        )
      })
      // mais recentes primeiro (data de saída do fluxo, com fallback na criação)
      .sort((a, b) => {
        const da = a.concluido_em ?? a.arquivado_em ?? a.cancelado_em ?? a.created_at
        const db = b.concluido_em ?? b.arquivado_em ?? b.cancelado_em ?? b.created_at
        return db.localeCompare(da)
      })
  }, [pedidos, busca, filtro])

  const inputCls =
    'rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-red-500'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">Arquivo</h1>
        <p className="text-sm text-slate-400">
          Pedidos finalizados • {arquivados.length} registro(s)
        </p>
      </div>

      {/* Busca e filtro */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por número, cliente…"
          className={`${inputCls} min-w-0 flex-1`}
        />
        <div className="flex rounded-lg border border-slate-700 p-0.5">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filtro === f.id ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {arquivados.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-500">
          Nenhum pedido arquivado nesta seleção.
        </p>
      ) : (
        <ul className="space-y-2">
          {arquivados.map((p) => (
            <li key={p.id}>
              <Link
                to={`/pedidos/${p.numero}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 transition-colors hover:border-slate-600"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-bold text-red-400">#{p.numero}</span>
                  <span className="truncate text-sm font-medium">{p.cliente}</span>
                  {p.descricao && (
                    <span className="hidden truncate text-xs text-slate-500 sm:inline">
                      {p.descricao}
                    </span>
                  )}
                  <span className="text-xs text-slate-600">{p.quantidade} un.</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-xs">
                  {p.status === 'concluido' ? (
                    <span className="rounded-full bg-emerald-900 px-2.5 py-1 font-medium text-emerald-300">
                      ✓ Concluído
                    </span>
                  ) : p.status === 'arquivado' ? (
                    <span className="rounded-full bg-violet-900 px-2.5 py-1 font-medium text-violet-300">
                      📥 Arquivado
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-800 px-2.5 py-1 font-medium text-slate-400">
                      Cancelado
                    </span>
                  )}
                  <span className="text-slate-500">
                    {formatarDataHora(
                      p.status === 'concluido'
                        ? p.concluido_em
                        : p.status === 'arquivado'
                          ? p.arquivado_em
                          : p.cancelado_em,
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
