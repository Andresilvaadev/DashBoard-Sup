import { memo, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../contexts/ToastContext'
import { supabase } from '../lib/supabase'
import { ABAS, type Aba } from '../lib/abas'
import type { Etapa, Pedido } from '../types'
import { formatarData, hojeISO } from '../utils/tempo'

const prioridadeBorda: Record<string, string> = {
  baixa: '',
  normal: '',
  alta: 'border-l-4 border-l-amber-500',
  urgente: 'border-l-4 border-l-rose-500',
}

/** Tempo de toque parado antes do card "grudar" no dedo (ms) */
const ESPERA_ARRASTE = 300
/** Movimento tolerado antes disso — acima, o gesto é rolagem, não arrasto */
const TOLERANCIA_ROLAGEM = 10

/**
 * Quadro Kanban: uma coluna por etapa ativa.
 *
 * Mover um card:
 *  • desktop — arrastar e soltar (API nativa do HTML5);
 *  • celular — segurar o card e arrastar (Pointer Events, porque a API do
 *    HTML5 não funciona em tela de toque), ou usar o botão ⇄;
 *  • por voz e pelo Realtime, que movem os cards sozinhos.
 */
// memo: o quadro só re-renderiza quando pedidos/etapas/fotos mudarem de fato
export default memo(function KanbanBoard({
  pedidos,
  etapas,
  ultrapassagens,
  fotos,
  onEditar,
  onExcluir,
  onMarcarArte,
  rotulosArte,
  onMoverAba,
}: {
  pedidos: Pedido[]
  etapas: Etapa[]
  ultrapassagens?: Record<string, number> // pedido.id → pedidos mais novos já à frente
  fotos?: Record<string, string> // pedido.id → URL da primeira foto anexada
  onEditar?: (p: Pedido) => void // apenas admin
  onExcluir?: (p: Pedido) => void // apenas admin
  onMarcarArte?: (p: Pedido) => void // qualquer funcionário pode marcar
  /** texto do botão de marcar — muda conforme a aba (arte x pedido) */
  rotulosArte?: { feito: string; pendente: string }
  /** move o pedido para outra aba (Pedidos/Criação/Canecas) — só admin e gestor */
  onMoverAba?: (p: Pedido, destino: Aba) => void
}) {
  const toast = useToast()
  const [colunaAlvo, setColunaAlvo] = useState<string | null>(null)
  const [movendo, setMovendo] = useState<number | null>(null)
  const [seletor, setSeletor] = useState<Pedido | null>(null) // bottom sheet p/ toque
  const hoje = hojeISO()

  // ---- arraste por toque (celular) ----
  const containerRef = useRef<HTMLDivElement>(null)
  /** card grudado no dedo, com a posição atual do toque */
  const [arraste, setArraste] = useState<{ pedido: Pedido; x: number; y: number } | null>(null)
  const arrasteRef = useRef(arraste)
  arrasteRef.current = arraste
  /** toque iniciado mas ainda não confirmado como arraste */
  const pressaoRef = useRef<{ timer: number; x: number; y: number } | null>(null)
  const arrastando = arraste !== null

  const cancelarPressao = () => {
    if (pressaoRef.current) {
      clearTimeout(pressaoRef.current.timer)
      pressaoRef.current = null
    }
  }
  // não deixa timer pendente se a tela for desmontada no meio do toque
  useEffect(() => cancelarPressao, [])

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

  /** Começa a contar o toque parado. Só toque — mouse segue pela API do HTML5. */
  const aoTocarCard = (e: React.PointerEvent, p: Pedido) => {
    if (e.pointerType !== 'touch') return
    // toque em botão ou link do card é clique, não arraste
    if ((e.target as HTMLElement).closest('button, a')) return
    const x = e.clientX
    const y = e.clientY
    cancelarPressao()
    const timer = window.setTimeout(() => {
      pressaoRef.current = null
      navigator.vibrate?.(12)
      setArraste({ pedido: p, x, y })
    }, ESPERA_ARRASTE)
    pressaoRef.current = { timer, x, y }
  }

  /** Dedo andou antes do tempo: era rolagem, desiste do arraste */
  const aoMoverNoCard = (e: React.PointerEvent) => {
    const pressao = pressaoRef.current
    if (!pressao) return
    if (
      Math.abs(e.clientX - pressao.x) > TOLERANCIA_ROLAGEM ||
      Math.abs(e.clientY - pressao.y) > TOLERANCIA_ROLAGEM
    ) {
      cancelarPressao()
    }
  }

  // Enquanto o card está grudado no dedo: acompanha o toque, destaca a coluna
  // sob ele, rola o quadro nas bordas e solta o pedido ao levantar o dedo.
  useEffect(() => {
    if (!arrastando) return

    const etapaSob = (x: number, y: number) =>
      (document.elementFromPoint(x, y) as HTMLElement | null)
        ?.closest('[data-etapa]')
        ?.getAttribute('data-etapa') ?? null

    const aoMover = (ev: PointerEvent) => {
      setArraste((a) => (a ? { ...a, x: ev.clientX, y: ev.clientY } : a))
      setColunaAlvo(etapaSob(ev.clientX, ev.clientY))
    }

    const aoSoltar = (ev: PointerEvent) => {
      const atual = arrasteRef.current
      const destino = etapaSob(ev.clientX, ev.clientY)
      setArraste(null)
      setColunaAlvo(null)
      if (!atual || !destino) return
      const etapa = etapas.find((x) => x.id === destino)
      if (!etapa || atual.pedido.etapa_atual_id === etapa.id) return
      navigator.vibrate?.(20)
      void mover(atual.pedido.numero, etapa)
    }

    // segura a rolagem da página enquanto o dedo arrasta (precisa ser
    // listener nativo não-passivo para o preventDefault valer)
    const bloquearRolagem = (ev: TouchEvent) => ev.preventDefault()

    document.addEventListener('pointermove', aoMover)
    document.addEventListener('pointerup', aoSoltar)
    document.addEventListener('pointercancel', aoSoltar)
    document.addEventListener('touchmove', bloquearRolagem, { passive: false })

    // com o dedo perto da borda, o quadro anda sozinho para o lado
    const rolagem = window.setInterval(() => {
      const a = arrasteRef.current
      const cont = containerRef.current
      if (!a || !cont) return
      const margem = 56
      if (a.x < margem) cont.scrollLeft -= 14
      else if (a.x > window.innerWidth - margem) cont.scrollLeft += 14
    }, 16)

    return () => {
      document.removeEventListener('pointermove', aoMover)
      document.removeEventListener('pointerup', aoSoltar)
      document.removeEventListener('pointercancel', aoSoltar)
      document.removeEventListener('touchmove', bloquearRolagem)
      clearInterval(rolagem)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrastando, etapas])

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
      {/* items-start: cada coluna tem a altura do próprio conteúdo. Sem isso o
          flex estica todas até a altura da mais cheia, e colunas vazias ficam
          com um vão enorme embaixo. */}
      <div
        ref={containerRef}
        className="-mx-4 flex snap-x items-start gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0"
      >
        {etapas.map((etapa) => {
          const cards = pedidos.filter((p) => p.etapa_atual_id === etapa.id && p.status !== 'cancelado')
          const destacada = colunaAlvo === etapa.id
          return (
            <div
              key={etapa.id}
              // usado pelo arraste por toque para saber sobre qual coluna o dedo está
              data-etapa={etapa.id}
              onDragOver={(e) => {
                e.preventDefault()
                setColunaAlvo(etapa.id)
              }}
              onDragLeave={() => setColunaAlvo((c) => (c === etapa.id ? null : c))}
              onDrop={(e) => onDrop(e, etapa)}
              className={`flex max-h-[70dvh] w-64 shrink-0 snap-start flex-col rounded-xl border bg-slate-900/60 transition-colors ${
                destacada ? 'border-red-500 bg-red-950/40' : 'border-slate-800'
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
              {/* min-h: mesmo vazia, a coluna mantém área suficiente para
                  receber um card arrastado */}
              <div className="min-h-20 flex-1 space-y-2 overflow-y-auto p-2">
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
                      // celular: segurar para arrastar (a API do HTML5 acima
                      // não funciona em tela de toque)
                      onPointerDown={(e) => aoTocarCard(e, p)}
                      onPointerMove={aoMoverNoCard}
                      onPointerUp={cancelarPressao}
                      onPointerCancel={cancelarPressao}
                      // pedido com ocorrência fica de borda vermelha: o
                      // problema tem que saltar aos olhos no quadro inteiro
                      className={`group cursor-grab select-none overflow-hidden rounded-lg bg-slate-900 p-3 shadow-sm transition-colors [-webkit-touch-callout:none] active:cursor-grabbing ${
                        p.ocorrencias
                          ? 'border-2 border-rose-500 hover:border-rose-400'
                          : 'border border-slate-800 hover:border-slate-600'
                      } ${prioridadeBorda[p.prioridade]} ${
                        movendo === p.numero ? 'opacity-40' : ''
                      } ${
                        arraste?.pedido.id === p.id ? 'opacity-30 ring-2 ring-red-500' : ''
                      }`}
                    >
                      {/* Foto do pedido (primeira imagem anexada) */}
                      {fotos?.[p.id] && (
                        <Link to={`/pedidos/${p.numero}`} draggable={false} className="-mx-3 -mt-3 mb-2 block">
                          <img
                            src={fotos[p.id]}
                            alt={`Foto do pedido ${p.numero}`}
                            loading="lazy"
                            draggable={false}
                            className="h-28 w-full object-cover"
                          />
                        </Link>
                      )}
                      {/* nº da OS e cliente: texto corrido, então o nome quebra
                          em mais linhas em vez de ser cortado. O nome sai no
                          mesmo tamanho e peso da OS — só a cor os separa. */}
                      <Link to={`/pedidos/${p.numero}`} className="block leading-snug">
                        <span className="mr-1.5 font-bold text-red-400 hover:underline">
                          #{p.numero}
                        </span>
                        <span className="font-bold text-slate-300">{p.cliente}</span>
                      </Link>
                      {/* Ação principal do card: discreta, mas em linha própria */}
                      {onMarcarArte && (
                        <button
                          onClick={() => onMarcarArte(p)}
                          title={p.arte_concluida ? 'Desmarcar' : 'Marcar como concluído'}
                          className={`mt-2 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            p.arte_concluida
                              ? 'border-emerald-700 bg-emerald-900 text-emerald-200 hover:bg-emerald-800'
                              : 'border-slate-700 text-slate-400 hover:border-emerald-600 hover:text-emerald-300'
                          }`}
                        >
                          {p.arte_concluida
                            ? (rotulosArte?.feito ?? '✓ Concluído')
                            : (rotulosArte?.pendente ?? '○ Marcar como concluído')}
                        </button>
                      )}
                      {/* Ocorrência: aviso de problema, em linha própria para
                          não se perder no meio das etiquetas */}
                      {p.ocorrencias && (
                        <p
                          title={p.ocorrencias}
                          className="mt-2 flex items-start gap-1 rounded-md bg-rose-950/60 px-2 py-1 text-[11px] leading-snug text-rose-200"
                        >
                          <span className="shrink-0">⚠</span>
                          <span className="line-clamp-2">{p.ocorrencias}</span>
                        </p>
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
                            ▲ {ultrapassagens?.[p.id]}
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
                          // data de entrega maior que as demais etiquetas: é o
                          // dado que define a ordem de prioridade do card
                          <span className="text-sm font-semibold text-slate-300">
                            entrega {formatarData(p.data_prevista)}
                          </span>
                        )}
                        <span className="text-slate-600">{p.quantidade} un.</span>
                      </div>

                      {/* Ações do card, no rodapé: separadas do conteúdo e sempre
                          no mesmo lugar, com área de toque confortável */}
                      <div className="mt-2 flex gap-1 border-t border-slate-800 pt-2">
                        {onEditar && (
                          <button
                            onClick={() => onEditar(p)}
                            title="Editar pedido"
                            className="flex-1 rounded-md bg-slate-800 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-amber-400"
                          >
                            ✎
                          </button>
                        )}
                        {onExcluir && (
                          <button
                            onClick={() => onExcluir(p)}
                            title="Excluir pedido"
                            className="flex-1 rounded-md bg-slate-800 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-rose-400"
                          >
                            ✕
                          </button>
                        )}
                        <button
                          onClick={() => setSeletor(p)}
                          title="Mover para outra etapa"
                          className="flex-1 rounded-md bg-slate-800 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-red-400"
                        >
                          ⇄
                        </button>
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

      {/* Card fantasma acompanhando o dedo durante o arraste por toque */}
      {arraste && (
        <div
          className="pointer-events-none fixed z-[90] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-red-500 bg-slate-900 px-3 py-2 shadow-2xl"
          style={{ left: arraste.x, top: arraste.y }}
        >
          <p className="text-sm font-bold text-red-400">#{arraste.pedido.numero}</p>
          <p className="max-w-[9rem] truncate text-[11px] text-slate-400">{arraste.pedido.cliente}</p>
        </div>
      )}

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
              Mover <span className="font-bold text-red-400">#{seletor.numero}</span> ({seletor.cliente}) para:
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {etapas.map((e) => (
                <button
                  key={e.id}
                  disabled={e.id === seletor.etapa_atual_id || movendo !== null}
                  onClick={() => void mover(seletor.numero, e)}
                  className="rounded-lg border border-slate-700 px-3 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-30"
                  style={e.id === seletor.etapa_atual_id ? { background: e.cor, color: '#0b1233' } : undefined}
                >
                  {e.ordem}. {e.nome}
                </button>
              ))}
            </div>

            {/* Trocar de aba: cada aba tem seu próprio fluxo, então o pedido
                recomeça na primeira etapa do destino */}
            {onMoverAba && (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <p className="mb-2 text-xs text-slate-500">Ou mover para outra aba:</p>
                <div className="flex gap-2">
                  {ABAS.filter((a) => a.tipo !== (seletor.tipo ?? 'pronto')).map((a) => (
                    <button
                      key={a.tipo}
                      disabled={movendo !== null}
                      onClick={() => {
                        onMoverAba(seletor, a)
                        setSeletor(null)
                      }}
                      className="flex-1 rounded-lg border border-slate-700 px-3 py-2.5 text-xs font-medium text-slate-300 transition-colors hover:border-sky-600 hover:text-sky-300 disabled:opacity-30"
                    >
                      → {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
})
