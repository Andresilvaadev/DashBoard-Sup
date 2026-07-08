import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../contexts/ToastContext'
import { supabase } from '../lib/supabase'
import type { Etapa, Pedido } from '../types'
import { formatarData, hojeISO } from '../utils/tempo'

const prioridadeBorda: Record<string, string> = {
  baixa: '',
  normal: '',
  alta: 'border-l-4 border-l-amber-500',
  urgente: 'border-l-4 border-l-rose-500',
}

/**
 * Quadro Kanban: uma coluna por etapa ativa. Arraste os cards entre colunas
 * (desktop) ou use o botão ⇄ (celular). Comandos de voz e Realtime também
 * movem os cards automaticamente.
 */
export default function KanbanBoard({
  pedidos,
  etapas,
  ultrapassagens,
  onEditar,
  onExcluir,
}: {
  pedidos: Pedido[]
  etapas: Etapa[]
  ultrapassagens?: Record<string, number> // pedido.id → pedidos mais novos já à frente
  onEditar?: (p: Pedido) => void // apenas admin
  onExcluir?: (p: Pedido) => void // apenas admin
}) {
  const toast = useToast()
  const [colunaAlvo, setColunaAlvo] = useState<string | null>(null)
  const [movendo, setMovendo] = useState<number | null>(null)
  const [seletor, setSeletor] = useState<Pedido | null>(null) // bottom sheet p/ toque
  const hoje = hojeISO()

  const mover = async (numero: number, etapa: Etapa) => {
    setMovendo(numero)
    const { error } = await supabase.rpc('mover_pedido', {
      p_numero: numero,
      p_etapa_id: etapa.id,
      p_observacao: '',
      p_via_voz: false,
    })
    setMovendo(null)
    setSeletor(null)
    if (error) toast(error.message, 'erro')
    else toast(`Pedido ${numero} → ${etapa.nome}`, 'sucesso')
  }

  const onDrop = (e: React.DragEvent, etapa: Etapa) => {
    e.preventDefault()
    setColunaAlvo(null)
    const numero = parseInt(e.dataTransfer.getData('text/plain'), 10)
    if (!numero) return
    const pedido = pedidos.find((p) => p.numero === numero)
    if (!pedido || pedido.etapa_atual_id === etapa.id) return
    void mover(numero, etapa)
  }

  return (
    <>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
        {etapas.map((etapa) => {
          const cards = pedidos.filter((p) => p.etapa_atual_id === etapa.id && p.status !== 'cancelado')
          const destacada = colunaAlvo === etapa.id
          return (
            <div
              key={etapa.id}
              onDragOver={(e) => {
                e.preventDefault()
                setColunaAlvo(etapa.id)
              }}
              onDragLeave={() => setColunaAlvo((c) => (c === etapa.id ? null : c))}
              onDrop={(e) => onDrop(e, etapa)}
              className={`flex max-h-[70dvh] w-64 shrink-0 snap-start flex-col rounded-xl border bg-slate-900/60 transition-colors ${
                destacada ? 'border-sky-500 bg-sky-950/40' : 'border-slate-800'
              }`}
            >
              {/* Cabeçalho da coluna */}
              <div
                className="flex items-center justify-between rounded-t-xl border-b border-slate-800 px-3 py-2.5"
                style={{ borderTop: `3px solid ${etapa.cor}`, marginTop: -1 }}
              >
                <span className="text-sm font-semibold" style={{ color: etapa.cor }}>
                  {etapa.nome}
                </span>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-400">
                  {cards.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 space-y-2 overflow-y-auto p-2">
                {cards.map((p) => {
                  const atrasado = p.status === 'em_andamento' && p.data_prevista && p.data_prevista < hoje
                  return (
                    <div
                      key={p.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', String(p.numero))
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      className={`group cursor-grab rounded-lg border border-slate-800 bg-slate-900 p-3 shadow-sm transition-colors hover:border-slate-600 active:cursor-grabbing ${
                        prioridadeBorda[p.prioridade]
                      } ${movendo === p.numero ? 'opacity-40' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link to={`/pedidos/${p.numero}`} className="min-w-0">
                          <p className="font-bold text-sky-400 hover:underline">#{p.numero}</p>
                          <p className="truncate text-xs font-medium text-slate-300">{p.cliente}</p>
                        </Link>
                        <div className="flex shrink-0 gap-1">
                          {onEditar && (
                            <button
                              onClick={() => onEditar(p)}
                              title="Editar pedido"
                              className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-amber-400"
                            >
                              ✎
                            </button>
                          )}
                          {onExcluir && (
                            <button
                              onClick={() => onExcluir(p)}
                              title="Excluir pedido"
                              className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-rose-400"
                            >
                              🗑
                            </button>
                          )}
                          <button
                            onClick={() => setSeletor(p)}
                            title="Mover para outra etapa"
                            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-sky-400"
                          >
                            ⇄
                          </button>
                        </div>
                      </div>
                      {p.descricao && (
                        <p className="mt-1 truncate text-[11px] text-slate-500">{p.descricao}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {atrasado && (
                          <span className="rounded-full bg-rose-900 px-2 py-0.5 font-semibold text-rose-300">
                            Atrasado
                          </span>
                        )}
                        {(ultrapassagens?.[p.id] ?? 0) > 0 && (
                          <span
                            title={`${ultrapassagens?.[p.id]} pedido(s) criado(s) depois deste já estão em etapa à frente`}
                            className="rounded-full bg-violet-900 px-2 py-0.5 font-semibold text-violet-300"
                          >
                            ⏫ {ultrapassagens?.[p.id]}
                          </span>
                        )}
                        {(p.prioridade === 'alta' || p.prioridade === 'urgente') && (
                          <span
                            className={`rounded-full px-2 py-0.5 font-semibold uppercase ${
                              p.prioridade === 'urgente'
                                ? 'bg-rose-900 text-rose-300'
                                : 'bg-amber-900 text-amber-300'
                            }`}
                          >
                            {p.prioridade}
                          </span>
                        )}
                        {p.data_prevista && (
                          <span className="text-slate-500">📅 {formatarData(p.data_prevista)}</span>
                        )}
                        <span className="text-slate-600">{p.quantidade} un.</span>
                      </div>
                    </div>
                  )
                })}
                {cards.length === 0 && (
                  <p className="py-6 text-center text-xs text-slate-600">
                    {destacada ? 'Solte aqui' : 'Vazio'}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Seletor de etapa (toque/celular) */}
      {seletor && (
        <div
          className="fixed inset-0 z-[85] flex items-end justify-center bg-black/60 p-4 md:items-center"
          onClick={() => setSeletor(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-slate-400">
              Mover <span className="font-bold text-sky-400">#{seletor.numero}</span> ({seletor.cliente}) para:
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {etapas.map((e) => (
                <button
                  key={e.id}
                  disabled={e.id === seletor.etapa_atual_id || movendo !== null}
                  onClick={() => void mover(seletor.numero, e)}
                  className="rounded-lg border border-slate-700 px-3 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-30"
                  style={e.id === seletor.etapa_atual_id ? { background: e.cor, color: '#0f172a' } : undefined}
                >
                  {e.ordem}. {e.nome}
                </button>
              ))}
            </div>
            <button
              onClick={() => setSeletor(null)}
              className="mt-4 w-full rounded-lg border border-slate-700 py-2.5 text-sm font-medium hover:bg-slate-800"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  )
}
