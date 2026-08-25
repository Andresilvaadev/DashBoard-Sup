import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import KanbanBoard from '../components/KanbanBoard'
import PedidoFormModal from '../components/PedidoFormModal'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { useEtapas } from '../hooks/useEtapas'
import { usePedidos } from '../hooks/usePedidos'
import { supabase } from '../lib/supabase'
import type { Pedido, TipoPedido } from '../types'
import { ABAS, abaDoTipo, fluxoDoTipo, rotulosConclusao, type Aba } from '../lib/abas'
import { urlsAnexos } from '../lib/anexos'
import { mapaUltrapassagens } from '../utils/fila'
import { removerAnexosStorage } from '../utils/storage'
import { formatarData, hojeISO } from '../utils/tempo'

const prioridadeBadge: Record<string, string> = {
  baixa: 'bg-slate-700 text-slate-300',
  normal: 'bg-blue-900 text-blue-300',
  alta: 'bg-amber-900 text-amber-300',
  urgente: 'bg-rose-900 text-rose-300',
}

/**
 * Ordena pela data de entrega: a mais próxima aparece primeiro, independente
 * de quando o pedido foi criado. Pedidos sem data de entrega vão para o fim
 * (não têm prazo definido); empates são desempatados pelo mais antigo.
 * As datas são 'aaaa-mm-dd', então a comparação de texto já dá a ordem certa.
 */
const porDataEntrega = (a: Pedido, b: Pedido) => {
  if (a.data_prevista !== b.data_prevista) {
    if (!a.data_prevista) return 1
    if (!b.data_prevista) return -1
    return a.data_prevista < b.data_prevista ? -1 : 1
  }
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
}

/** Mesma tela para as duas abas: Pedidos (arte pronta) e Pedidos para criação. */
export default function Pedidos({ tipo = 'pronto' }: { tipo?: TipoPedido }) {
  // admin OU gestor criam/editam pedidos; funcionário só move de etapa
  const { podeGerenciarPedidos: podeGerenciar } = useAuth()
  const toast = useToast()
  const confirmar = useConfirm()
  const { pedidos, recarregar } = usePedidos()
  const { etapas, etapasDoFluxo } = useEtapas()
  // cada aba usa o seu fluxo de etapas (produção / criação / caneca)
  const etapasDaAba = etapasDoFluxo(fluxoDoTipo(tipo))
  const [busca, setBusca] = useState('')
  const [filtroEtapa, setFiltroEtapa] = useState('')
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

  // pedido.id → URL assinada da primeira foto anexada (bucket é privado)
  const [fotos, setFotos] = useState<Record<string, string>>({})
  useEffect(() => {
    let ativo = true
    const carregarFotos = async () => {
      const { data } = await supabase
        .from('anexos')
        .select('pedido_id, path')
        .like('tipo', 'image/%')
        .order('created_at', { ascending: true })
      const primeiraPorPedido = new Map<string, string>()
      for (const a of (data ?? []) as { pedido_id: string; path: string }[]) {
        if (!primeiraPorPedido.has(a.pedido_id)) primeiraPorPedido.set(a.pedido_id, a.path)
      }
      if (primeiraPorPedido.size === 0) {
        if (ativo) setFotos({})
        return
      }
      // miniaturas (Cloudinary ou URL assinada do Storage)
      const urlPorPath = await urlsAnexos([...primeiraPorPedido.values()], { miniatura: true })
      const mapa: Record<string, string> = {}
      for (const [pedidoId, path] of primeiraPorPedido) {
        if (urlPorPath[path]) mapa[pedidoId] = urlPorPath[path]
      }
      if (ativo) setFotos(mapa)
    }
    void carregarFotos()
    return () => {
      ativo = false
    }
  }, [pedidos])

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return pedidos
      .filter((p) => {
        // Pedidos = produção do dia a dia (em andamento). Concluídos e
        // cancelados ficam na aba Arquivo.
        if (p.status !== 'em_andamento') return false
        // separa as abas: arte pronta x criação (pedidos antigos contam como 'pronto')
        if ((p.tipo ?? 'pronto') !== tipo) return false
        if (filtroEtapa && p.etapa_atual_id !== filtroEtapa) return false
        if (!q) return true
        return (
          String(p.numero).includes(q) ||
          p.cliente.toLowerCase().includes(q) ||
          p.descricao.toLowerCase().includes(q)
        )
      })
      // entrega mais próxima primeiro (vale para o Kanban e para a Lista)
      .sort(porDataEntrega)
  }, [pedidos, busca, filtroEtapa, tipo])

  // handlers estáveis (useCallback): permitem que o KanbanBoard memoizado
  // não re-renderize à toa quando o estado local desta página muda
  const excluir = useCallback(
    async (p: Pedido) => {
      if (
        !(await confirmar({
          titulo: `Excluir pedido ${p.numero}`,
          mensagem: `O histórico e os anexos de ${p.cliente} também serão apagados. Essa ação não pode ser desfeita.`,
          textoConfirmar: 'Excluir tudo',
          perigo: true,
        }))
      )
        return
      const { data, error } = await supabase.rpc('excluir_pedido', { p_numero: p.numero })
      if (error) {
        toast(error.message, 'erro')
      } else {
        await removerAnexosStorage((data as string[]) ?? [])
        toast(`Pedido ${p.numero} excluído.`, 'sucesso')
        recarregar()
      }
    },
    [confirmar, toast, recarregar],
  )
  const abrirEdicao = useCallback((p: Pedido) => setModal(p), [])
  const excluirClique = useCallback((p: Pedido) => void excluir(p), [excluir])

  /**
   * Liga/desliga a marcação de "pronto" direto no card: a arte, na aba
   * Criação; o pedido, nas demais. Vai por RPC, e não por update na tabela,
   * para qualquer funcionário poder marcar sem ganhar permissão de editar
   * o resto do pedido.
   */
  const marcarArte = useCallback(
    async (p: Pedido) => {
      const eArte = (p.tipo ?? 'pronto') === 'criacao'
      const { error } = await supabase.rpc('marcar_arte', {
        p_pedido_id: p.id,
        p_concluida: !p.arte_concluida,
      })
      if (error) toast(error.message, 'erro')
      else {
        const oQue = eArte ? 'arte' : 'pedido'
        toast(
          p.arte_concluida
            ? `#${p.numero}: ${oQue} desmarcado.`
            : `#${p.numero}: ${eArte ? 'arte pronta!' : 'concluído!'}`,
          'sucesso',
        )
        recarregar()
      }
    },
    [toast, recarregar],
  )
  const marcarArteClique = useCallback((p: Pedido) => void marcarArte(p), [marcarArte])

  /**
   * Move o pedido para OUTRA aba (Pedidos ↔ Criação ↔ Canecas). Cada aba tem
   * seu próprio fluxo, então o pedido recomeça na primeira etapa do destino.
   */
  const moverParaAba = useCallback(
    async (p: Pedido, destino: Aba) => {
      const primeira = etapasDoFluxo(destino.fluxo)[0]
      if (!primeira) {
        toast(`A aba "${destino.label}" ainda não tem etapas configuradas.`, 'erro')
        return
      }
      if (
        !(await confirmar({
          titulo: `Mover para ${destino.label}`,
          mensagem: `O pedido ${p.numero} vai recomeçar na etapa "${primeira.nome}".`,
          textoConfirmar: 'Mover',
        }))
      )
        return

      // RPC em vez de update na tabela: o funcionário também move de aba,
      // sem ganhar permissão de editar o resto do pedido
      const { error } = await supabase.rpc('mover_pedido_aba', {
        p_numero: p.numero,
        p_tipo: destino.tipo,
      })

      if (error) toast(error.message, 'erro')
      else {
        toast(`Pedido ${p.numero} movido para ${destino.label}.`, 'sucesso')
        recarregar()
      }
    },
    [confirmar, etapasDoFluxo, toast, recarregar],
  )
  const moverParaAbaClique = useCallback(
    (p: Pedido, destino: Aba) => void moverParaAba(p, destino),
    [moverParaAba],
  )

  // texto do botão de marcar: "arte" na aba Criação, "concluído" nas demais
  const rotulos = rotulosConclusao(tipo)

  const hoje = hojeISO()
  const inputCls =
    'rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-red-500'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold md:text-2xl">
            {tipo === 'criacao' ? 'Pedidos para criação' : abaDoTipo(tipo).label}
          </h1>
          <p className="text-sm text-slate-400">
            {filtrados.length} pedido(s)
            {tipo === 'criacao' && ' aguardando criação de arte'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Alternância Kanban / Lista */}
          <div className="flex rounded-lg border border-slate-700 p-0.5">
            <button
              onClick={() => trocarVisao('kanban')}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                visao === 'kanban' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ▦ Kanban
            </button>
            <button
              onClick={() => trocarVisao('lista')}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                visao === 'lista' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ☰ Lista
            </button>
          </div>
          {podeGerenciar && (
            <button
              onClick={() => setModal('novo')}
              className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500"
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
          <option value="">Todas as etapas</option>
          {etapasDaAba.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </select>
      </div>

      {/* Kanban: arraste os cards entre colunas ou use ⇄ no celular */}
      {visao === 'kanban' && (
        <KanbanBoard
          pedidos={filtrados}
          etapas={etapasDaAba}
          ultrapassagens={ultrapassagens}
          fotos={fotos}
          onEditar={podeGerenciar ? abrirEdicao : undefined}
          onExcluir={podeGerenciar ? excluirClique : undefined}
          onMarcarArte={marcarArteClique}
          rotulosArte={rotulos}
          onMoverAba={moverParaAbaClique}
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
              className={`overflow-hidden rounded-xl border bg-slate-900 p-4 transition-colors hover:border-slate-600 ${
                atrasado ? 'border-rose-800' : 'border-slate-800'
              }`}
            >
              {/* Foto do pedido (primeira imagem anexada) */}
              {fotos[p.id] && (
                <Link to={`/pedidos/${p.numero}`} className="-mx-4 -mt-4 mb-3 block">
                  <img
                    src={fotos[p.id]}
                    alt={`Foto do pedido ${p.numero}`}
                    loading="lazy"
                    className="h-40 w-full object-cover"
                  />
                </Link>
              )}
              <div className="flex items-start justify-between gap-2">
                <Link to={`/pedidos/${p.numero}`} className="min-w-0">
                  <p className="text-lg font-bold text-red-400 hover:underline">#{p.numero}</p>
                  <p className="truncate text-sm font-medium">{p.cliente}</p>
                  {p.descricao && <p className="truncate text-xs text-slate-500">{p.descricao}</p>}
                </Link>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${prioridadeBadge[p.prioridade]}`}>
                  {p.prioridade}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  onClick={() => void marcarArte(p)}
                  title={p.arte_concluida ? 'Desmarcar' : 'Marcar como concluído'}
                  className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
                    p.arte_concluida
                      ? 'bg-emerald-900 text-emerald-300 hover:bg-emerald-800'
                      : 'border border-slate-700 text-slate-500 hover:border-emerald-700 hover:text-emerald-400'
                  }`}
                >
                  {p.arte_concluida ? rotulos.feito : rotulos.pendente}
                </button>
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
                      background: `${p.etapa_atual?.cor ?? '#ec1c24'}22`,
                      color: p.etapa_atual?.cor ?? '#ec1c24',
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
                    ▲ {ultrapassagens[p.id]} na frente
                  </span>
                )}
                {p.data_prevista && (
                  <span className="text-slate-500">Entrega: {formatarData(p.data_prevista)}</span>
                )}
              </div>

              {podeGerenciar && (
                <div className="mt-3 flex gap-2 border-t border-slate-800 pt-3 text-xs">
                  <button onClick={() => setModal(p)} className="text-slate-400 hover:text-red-400">
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
          tipoNovo={tipo}
          onFechar={() => setModal(null)}
          onSalvo={recarregar}
        />
      )}
    </div>
  )
}
