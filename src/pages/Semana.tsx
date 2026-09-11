import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FaixaDias,
  ResumoSemana,
  TarefaCard,
  dataDoDia,
  diaMes,
  nomeDia,
  rotuloDia,
  type ContagemDia,
} from '../components/SemanaPartes'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { usePedidos } from '../hooks/usePedidos'
import { urlsAnexos } from '../lib/anexos'
import { supabase } from '../lib/supabase'
import type { PlanoSemana, SemanaSetor } from '../types'
import { dataLocal } from '../utils/tempo'

// cores atribuídas automaticamente aos setores novos
const CORES_SETOR = ['#ec1c24', '#f59e0b', '#818cf8', '#34d399', '#f472b6', '#a78bfa', '#fb923c', '#22c55e']
const COR_GERAL = '#6b77ad'

/** segunda-feira da semana atual + deslocamento em semanas */
function segundaDaSemana(offsetSemanas: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const dia = d.getDay()
  d.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1) + offsetSemanas * 7)
  return d
}

/** dia que a tela abre: hoje, se for dia útil da semana mostrada; senão a segunda */
function diaInicial(offset: number): number {
  if (offset !== 0) return 0
  const dow = new Date().getDay()
  return dow >= 1 && dow <= 5 ? dow - 1 : 0
}

const contar = (lista: PlanoSemana[]): ContagemDia => ({
  total: lista.length,
  feitas: lista.filter((i) => i.feito).length,
})

/**
 * Semana: o que cada setor tem para fazer em cada dia.
 *
 * Organizada por DIA, porque a pergunta de quem está na produção é "o que
 * eu faço hoje?" — a tela abre no dia de hoje e mostra, por setor, só o
 * que está planejado. Quem organiza tem a visão "Semana" (setores × dias)
 * para ver a carga e o que ficou por fazer de dias anteriores.
 *
 * Cada item é uma REFERÊNCIA ao pedido — ele continua na aba dele, e o
 * cartão mostra ao vivo em qual etapa está agora, com a foto do pedido.
 */
export default function Semana() {
  // admin OU gestor montam o planejamento; funcionário consulta e marca feito
  const { podeGerenciarPedidos: podeGerenciar } = useAuth()
  const toast = useToast()
  const confirmar = useConfirm()
  const { pedidos } = usePedidos()
  const [params, setParams] = useSearchParams()
  const [offset, setOffset] = useState(0)
  const [itens, setItens] = useState<PlanoSemana[]>([])
  // tarefas NÃO feitas de semanas anteriores (só carregadas na semana atual)
  const [anteriores, setAnteriores] = useState<PlanoSemana[]>([])
  const [setores, setSetores] = useState<SemanaSetor[]>([])
  const [fotos, setFotos] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)
  const [visao, setVisao] = useState<'dia' | 'semana'>('dia')
  const [diaAtivo, setDiaAtivo] = useState(() => diaInicial(0))
  // filtro de visualização: 'todos' | 'geral' | id do setor
  const [filtroSetor, setFiltroSetor] = useState('todos')
  // formulário: já aberto quando se chega pelo botão do pedido (?pedido=)
  const [formAberto, setFormAberto] = useState(() => Boolean(params.get('pedido')))
  const [criandoSetor, setCriandoSetor] = useState(false)
  const [novoSetor, setNovoSetor] = useState('')
  const [setorSel, setSetorSel] = useState('')
  const [diaSel, setDiaSel] = useState(() => diaInicial(0))
  const [numeroPedido, setNumeroPedido] = useState(params.get('pedido') ?? '')
  const [texto, setTexto] = useState('')

  const segunda = useMemo(() => segundaDaSemana(offset), [offset])
  /** dias úteis planejáveis: segunda a sexta */
  const diasSemana = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => {
        const d = new Date(segunda)
        d.setDate(d.getDate() + i)
        return d
      }),
    [segunda],
  )
  /** sábado e domingo: só aparecem se já houver algo planejado neles */
  const fimDeSemana = useMemo(
    () =>
      Array.from({ length: 2 }, (_, i) => {
        const d = new Date(segunda)
        d.setDate(d.getDate() + 5 + i)
        return d
      }),
    [segunda],
  )
  const diasVisiveis = useMemo(
    () => [...diasSemana, ...fimDeSemana.filter((d) => itens.some((i) => i.dia === dataLocal(d)))],
    [diasSemana, fimDeSemana, itens],
  )
  const hojeIso = dataLocal(new Date())

  // ao trocar de semana, abre no dia de hoje (ou na segunda)
  useEffect(() => {
    setDiaAtivo(diaInicial(offset))
  }, [offset])
  // se o dia escolhido deixar de existir (sábado sem tarefas), cai no último
  const diaIdx = Math.min(diaAtivo, diasVisiveis.length - 1)
  const diaEscolhido = diasVisiveis[diaIdx]

  const pedidoPorId = useMemo(() => new Map(pedidos.map((p) => [p.id, p])), [pedidos])
  const setorPorId = useMemo(() => new Map(setores.map((s) => [s.id, s])), [setores])

  const carregar = async () => {
    const buscarAnteriores = async (): Promise<PlanoSemana[]> => {
      if (offset !== 0) return []
      const { data } = await supabase
        .from('plano_semana')
        .select('*')
        .eq('feito', false)
        .lt('dia', dataLocal(diasSemana[0]))
        .order('dia')
        .limit(100)
      return (data as PlanoSemana[]) ?? []
    }
    const [pl, st, ant] = await Promise.all([
      supabase
        .from('plano_semana')
        .select('*')
        .gte('dia', dataLocal(diasSemana[0]))
        .lte('dia', dataLocal(fimDeSemana[1]))
        .order('dia'),
      supabase.from('semana_setores').select('*').order('ordem').order('nome'),
      buscarAnteriores(),
    ])
    if (pl.error) toast(pl.error.message, 'erro')
    setItens((pl.data as PlanoSemana[]) ?? [])
    setSetores((st.data as SemanaSetor[]) ?? [])
    setAnteriores(ant)
  }

  useEffect(() => {
    void carregar()
    const canal = supabase
      .channel(`semana-rt-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plano_semana' }, () => void carregar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'semana_setores' }, () => void carregar())
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset])

  // foto do pedido (primeira imagem anexada) para cada item do plano
  useEffect(() => {
    let ativo = true
    const ids = [...new Set([...itens, ...anteriores].map((i) => i.pedido_id).filter(Boolean))] as string[]
    if (ids.length === 0) {
      setFotos({})
      return
    }
    const buscar = async () => {
      const { data } = await supabase
        .from('anexos')
        .select('pedido_id, path')
        .in('pedido_id', ids)
        .like('tipo', 'image/%')
        .order('created_at', { ascending: true })
      const primeira = new Map<string, string>()
      for (const a of (data ?? []) as { pedido_id: string; path: string }[]) {
        if (!primeira.has(a.pedido_id)) primeira.set(a.pedido_id, a.path)
      }
      if (primeira.size === 0) {
        if (ativo) setFotos({})
        return
      }
      const urls = await urlsAnexos([...primeira.values()], { miniatura: true })
      const mapa: Record<string, string> = {}
      for (const [pid, path] of primeira) if (urls[path]) mapa[pid] = urls[path]
      if (ativo) setFotos(mapa)
    }
    void buscar()
    return () => {
      ativo = false
    }
  }, [itens, anteriores])

  // ---------- recortes para a tela ----------
  const passaFiltro = (i: PlanoSemana) => filtroSetor === 'todos' || (i.setor_id ?? 'geral') === filtroSetor
  const itensFiltrados = itens.filter(passaFiltro)

  /** setores na ordem da tela, com "Geral" (tarefas sem setor) no fim */
  const ordemSetores = useMemo(
    () => [
      ...setores.map((s) => ({ chave: s.id, nome: s.nome, cor: s.cor })),
      { chave: 'geral', nome: 'Geral', cor: COR_GERAL },
    ],
    [setores],
  )

  const contagens = diasVisiveis.map((d) => contar(itensFiltrados.filter((i) => i.dia === dataLocal(d))))
  const contagemDoDia = contagens[diaIdx] ?? { total: 0, feitas: 0 }
  const contagemSemana = contar(itensFiltrados)

  // tarefas do dia escolhido, por setor; as por fazer primeiro
  const secoesDoDia = ordemSetores
    .map((s) => ({
      ...s,
      itens: itensFiltrados
        .filter((i) => i.dia === dataLocal(diaEscolhido) && (i.setor_id ?? 'geral') === s.chave)
        .sort((a, b) => Number(a.feito) - Number(b.feito)),
    }))
    .filter((s) => s.itens.length > 0)

  // "Ficou por fazer": o que não foi feito em dias que já passaram
  const pendentes =
    offset === 0
      ? [...anteriores, ...itens.filter((i) => !i.feito && i.dia < hojeIso)].filter(passaFiltro)
      : []
  const hojeNaFaixa = diasSemana.some((d) => dataLocal(d) === hojeIso)
  // aparece no dia de hoje; no fim de semana (sem "hoje" na faixa), em qualquer dia
  const mostrarPendentes =
    visao === 'dia' && pendentes.length > 0 && (hojeNaFaixa ? dataLocal(diaEscolhido) === hojeIso : true)

  const linhasResumo = ordemSetores
    .map((s) => ({
      ...s,
      porDia: diasVisiveis.map((d) =>
        contar(itensFiltrados.filter((i) => (i.setor_id ?? 'geral') === s.chave && i.dia === dataLocal(d))),
      ),
    }))
    .filter((l) => l.porDia.some((c) => c.total > 0))

  const numDigitado = parseInt(numeroPedido, 10)
  const pedidoDigitado = numDigitado ? pedidos.find((p) => p.numero === numDigitado) : undefined
  const setorEscolhido = setores.find((s) => s.id === setorSel) ?? null

  // ---------- ações ----------
  const abrirForm = () => {
    setDiaSel(Math.min(diaIdx, 4))
    setFormAberto(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Criação por campo na própria tela (sem prompt() do navegador, que é
  // bloqueado silenciosamente em PWA/alguns navegadores).
  const criarSetor = async () => {
    const nome = novoSetor.trim()
    if (!nome) {
      toast('Digite o nome do setor.', 'erro')
      return
    }
    const cor = CORES_SETOR[setores.length % CORES_SETOR.length]
    const ordem = Math.max(0, ...setores.map((s) => s.ordem)) + 1
    const { data, error } = await supabase.from('semana_setores').insert({ nome, cor, ordem }).select()
    if (error) {
      // erro de permissão: explica em vez de mostrar o jargão do banco
      const semPermissao = error.code === '42501' || /row-level security|permission/i.test(error.message)
      toast(
        semPermissao
          ? 'Sua conta não tem permissão de administrador NESTE projeto do banco. Promova-a e faça login novamente.'
          : error.message,
        'erro',
      )
      return
    }
    const criado = (data as SemanaSetor[] | null)?.[0]
    if (criado) {
      setSetores((arr) => [...arr, criado])
      setSetorSel(criado.id)
    }
    setNovoSetor('')
    setCriandoSetor(false)
    toast(`Setor "${nome}" criado.`, 'sucesso')
  }

  const excluirSetor = async () => {
    const s = setores.find((x) => x.id === setorSel)
    if (!s) return
    if (
      !(await confirmar({
        titulo: 'Excluir setor',
        mensagem: `Excluir o setor "${s.nome}"? As tarefas dele vão para "Geral".`,
        textoConfirmar: 'Excluir',
        perigo: true,
      }))
    )
      return
    const { error } = await supabase.from('semana_setores').delete().eq('id', s.id)
    if (error) {
      const semPermissao = error.code === '42501' || /row-level security|permission/i.test(error.message)
      toast(semPermissao ? 'Sua conta não tem permissão de administrador NESTE projeto do banco.' : error.message, 'erro')
    } else {
      setSetorSel('')
      if (filtroSetor === s.id) setFiltroSetor('todos')
      void carregar()
    }
  }

  const adicionar = async () => {
    let pedidoId: string | null = null
    if (numDigitado) {
      if (!pedidoDigitado) {
        toast(`Pedido ${numDigitado} não encontrado.`, 'erro')
        return
      }
      pedidoId = pedidoDigitado.id
    }
    if (!pedidoId && !texto.trim()) {
      toast('Informe o número do pedido ou escreva a tarefa.', 'erro')
      return
    }
    setSalvando(true)
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('plano_semana').insert({
      pedido_id: pedidoId,
      setor_id: setorSel || null,
      dia: dataLocal(diasSemana[diaSel]),
      texto: texto.trim(),
      created_by: userData.user?.id,
    })
    setSalvando(false)
    if (error) toast(error.message, 'erro')
    else {
      toast(`Adicionado em ${rotuloDia(diasSemana[diaSel])}.`, 'sucesso')
      setNumeroPedido('')
      setTexto('')
      if (params.get('pedido')) setParams({}, { replace: true })
      // mostra o dia onde a tarefa entrou; o formulário fica aberto para a próxima
      setVisao('dia')
      setDiaAtivo(diaSel)
      void carregar()
    }
  }

  const alternarFeito = async (it: PlanoSemana) => {
    const inverter = (arr: PlanoSemana[]) => arr.map((x) => (x.id === it.id ? { ...x, feito: !x.feito } : x))
    setItens(inverter)
    setAnteriores(inverter)
    // função própria no banco: funcionário só consegue mudar o "feito",
    // sem poder editar o resto da tarefa (edição é só admin/gestor)
    const { error } = await supabase.rpc('marcar_feito_semana', { p_id: it.id, p_feito: !it.feito })
    if (error) {
      toast(error.message, 'erro')
      void carregar()
    }
  }

  /** passa a tarefa para outro dia, sem precisar apagar e criar de novo */
  const moverDia = async (it: PlanoSemana, indice: number) => {
    const destino = diasVisiveis[indice]
    if (!destino) return
    const dia = dataLocal(destino)
    if (dia === it.dia) return
    // .select(): se a permissão barrar, o banco não dá erro — só não muda
    // nenhuma linha. Sem conferir, a tela diria "movida" à toa.
    const { data, error } = await supabase.from('plano_semana').update({ dia }).eq('id', it.id).select('id')
    if (error) toast(error.message, 'erro')
    else if (!data || data.length === 0) toast('Sua conta não tem permissão para mover tarefas.', 'erro')
    else {
      toast(`Tarefa movida para ${rotuloDia(destino)}.`, 'sucesso')
      void carregar()
    }
  }

  const excluir = async (it: PlanoSemana) => {
    if (
      !(await confirmar({
        titulo: 'Remover tarefa',
        mensagem: 'Remover esta tarefa do plano da semana?',
        textoConfirmar: 'Remover',
        perigo: true,
      }))
    )
      return
    const { error } = await supabase.from('plano_semana').delete().eq('id', it.id)
    if (error) toast(error.message, 'erro')
    else void carregar()
  }

  const cartao = (it: PlanoSemana, extras: { origem?: string; mostrarSetor?: boolean } = {}) => (
    <TarefaCard
      key={it.id}
      item={it}
      pedido={it.pedido_id ? pedidoPorId.get(it.pedido_id) : undefined}
      foto={it.pedido_id ? fotos[it.pedido_id] : undefined}
      setor={it.setor_id ? (setorPorId.get(it.setor_id) ?? null) : null}
      podeGerenciar={podeGerenciar}
      dias={diasVisiveis}
      onAlternar={() => void alternarFeito(it)}
      onMover={(i) => void moverDia(it, i)}
      onExcluir={() => void excluir(it)}
      {...extras}
    />
  )

  const chipFiltro = (ativo: boolean) =>
    `shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
      ativo ? 'text-white' : 'border border-slate-700 text-slate-400 hover:bg-slate-800'
    }`
  const pct = contagemSemana.total ? Math.round((contagemSemana.feitas / contagemSemana.total) * 100) : 0

  return (
    <div className="space-y-4">
      {/* ---- título, navegação entre semanas e nova tarefa ---- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight">Semana</h1>
          <p className="text-sm text-slate-400">
            Seg {diaMes(diasSemana[0])} a Sex {diaMes(diasSemana[4])}
            {contagemSemana.total > 0 && ` · ${contagemSemana.feitas} de ${contagemSemana.total} tarefas feitas`}
          </p>
          {contagemSemana.total > 0 && (
            <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-slate-700 bg-slate-900 p-1">
            <button
              onClick={() => setOffset((o) => o - 1)}
              aria-label="Semana anterior"
              className="h-9 w-9 rounded-lg text-lg text-slate-300 hover:bg-slate-800"
            >
              ‹
            </button>
            <button
              onClick={() => setOffset(0)}
              className={`h-9 rounded-lg px-3 text-xs font-bold ${
                offset === 0 ? 'text-red-400' : 'text-slate-200 hover:bg-slate-800'
              }`}
            >
              {offset === 0 ? 'Esta semana' : 'Voltar para hoje'}
            </button>
            <button
              onClick={() => setOffset((o) => o + 1)}
              aria-label="Próxima semana"
              className="h-9 w-9 rounded-lg text-lg text-slate-300 hover:bg-slate-800"
            >
              ›
            </button>
          </div>
          {podeGerenciar && !formAberto && (
            <button
              onClick={abrirForm}
              className="h-11 flex-1 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-500 sm:flex-none"
            >
              + Nova tarefa
            </button>
          )}
        </div>
      </div>

      {/* ---- nova tarefa (admin/gestor) ---- */}
      {podeGerenciar && formAberto && (
        <section
          className="rounded-2xl border bg-slate-900 p-4 shadow-lg"
          style={{ borderColor: setorEscolhido ? `${setorEscolhido.cor}99` : '#2a3670' }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold">Nova tarefa</h2>
            <button
              onClick={() => setFormAberto(false)}
              aria-label="Fechar"
              className="h-9 w-9 rounded-lg text-slate-400 hover:bg-slate-800"
            >
              ✕
            </button>
          </div>

          <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Setor</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setSetorSel('')}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                setorSel === '' ? 'border-slate-400 bg-slate-500 text-white' : 'border-slate-700 text-slate-400'
              }`}
            >
              Geral
            </button>
            {setores.map((s) => (
              <button
                key={s.id}
                onClick={() => setSetorSel(s.id)}
                className="rounded-full border px-3 py-1.5 text-xs font-bold"
                style={
                  setorSel === s.id
                    ? { background: s.cor, borderColor: s.cor, color: '#060b26' }
                    : { borderColor: `${s.cor}66`, color: s.cor }
                }
              >
                {s.nome}
              </button>
            ))}
            {/* o admin cria os próprios setores — só os que a produção usa */}
            <button
              onClick={() => setCriandoSetor((v) => !v)}
              className="rounded-full border border-dashed border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-400 hover:border-emerald-500 hover:text-emerald-400"
            >
              + Setor
            </button>
          </div>
          {criandoSetor && (
            <div className="mt-2 flex gap-1.5">
              <input
                autoFocus
                value={novoSetor}
                onChange={(e) => setNovoSetor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void criarSetor()
                  if (e.key === 'Escape') {
                    setCriandoSetor(false)
                    setNovoSetor('')
                  }
                }}
                placeholder="Nome do setor (ex.: Prensagem)"
                className="min-w-0 flex-1 rounded-xl border border-emerald-800 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              />
              <button
                onClick={() => void criarSetor()}
                className="shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500"
              >
                Criar
              </button>
            </div>
          )}
          {setorEscolhido && (
            <button
              onClick={() => void excluirSetor()}
              className="mt-1.5 text-[11px] text-slate-500 hover:text-rose-400"
            >
              Excluir o setor “{setorEscolhido.nome}”
            </button>
          )}

          <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Dia</p>
          <div className="grid grid-cols-5 gap-1.5">
            {diasSemana.map((d, i) => (
              <button
                key={dataLocal(d)}
                onClick={() => setDiaSel(i)}
                className={`rounded-xl border py-2 text-xs font-extrabold uppercase transition-colors ${
                  diaSel === i
                    ? 'border-red-500 bg-red-600 text-white'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                {nomeDia(d)}
                <span className="block text-[10px] font-normal normal-case opacity-80">{diaMes(d)}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[9rem_1fr]">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Nº do pedido
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={numeroPedido}
                onChange={(e) => setNumeroPedido(e.target.value)}
                placeholder="opcional"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500"
              />
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                O que fazer
              </label>
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void adicionar()}
                placeholder="ex.: prensar 20 camisas"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500"
              />
            </div>
          </div>
          {/* confere o pedido enquanto digita: evita planejar o número errado */}
          {numeroPedido &&
            (pedidoDigitado ? (
              <p className="mt-1.5 text-xs text-slate-300">
                <span className="font-black text-red-400">#{pedidoDigitado.numero}</span>{' '}
                <span className="font-semibold">{pedidoDigitado.cliente}</span>
                {pedidoDigitado.etapa_atual && (
                  <span className="text-slate-500"> · agora em {pedidoDigitado.etapa_atual.nome}</span>
                )}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-amber-400">Pedido {numeroPedido} não encontrado.</p>
            ))}

          <button
            onClick={() => void adicionar()}
            disabled={salvando}
            className="mt-3 h-12 w-full rounded-xl bg-red-600 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50"
          >
            {salvando ? 'Adicionando…' : `+ Adicionar em ${rotuloDia(diasSemana[diaSel])}`}
          </button>
        </section>
      )}

      {/* ---- filtro por setor: cada um vê só o que é dele ---- */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <button
          onClick={() => setFiltroSetor('todos')}
          className={chipFiltro(filtroSetor === 'todos')}
          style={filtroSetor === 'todos' ? { background: '#d3131b' } : undefined}
        >
          Todos os setores
        </button>
        {setores.map((s) => (
          <button
            key={s.id}
            onClick={() => setFiltroSetor(s.id)}
            className={chipFiltro(filtroSetor === s.id)}
            style={filtroSetor === s.id ? { background: s.cor, color: '#060b26' } : undefined}
          >
            {s.nome}
          </button>
        ))}
        <button
          onClick={() => setFiltroSetor('geral')}
          className={chipFiltro(filtroSetor === 'geral')}
          style={filtroSetor === 'geral' ? { background: COR_GERAL } : undefined}
        >
          Geral
        </button>
      </div>

      {/* ---- faixa de dias ---- */}
      <div>
        <FaixaDias
          dias={diasVisiveis}
          ativo={diaIdx}
          visaoSemana={visao === 'semana'}
          hoje={hojeIso}
          contagens={contagens}
          onEscolher={(i) => {
            setVisao('dia')
            setDiaAtivo(i)
          }}
          onSemana={() => setVisao('semana')}
        />
        <p className="mt-1.5 text-[11px] text-slate-500">
          O número em cada dia é o que falta fazer · ✓ quando está tudo feito
        </p>
      </div>

      {visao === 'semana' ? (
        /* ---- visão da semana: setores × dias ---- */
        linhasResumo.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-700 py-12 text-center text-sm text-slate-500">
            Nada planejado para esta semana{filtroSetor !== 'todos' ? ' neste setor' : ''}.
          </p>
        ) : (
          <ResumoSemana
            dias={diasVisiveis}
            hoje={hojeIso}
            linhas={linhasResumo}
            onAbrir={(i, chave) => {
              setVisao('dia')
              setDiaAtivo(i)
              setFiltroSetor(chave)
            }}
          />
        )
      ) : (
        /* ---- visão do dia ---- */
        <>
          {mostrarPendentes && (
            <section className="rounded-2xl border border-amber-600/50 bg-amber-950/20 p-3 sm:p-4">
              <h2 className="flex items-center gap-2 text-sm font-extrabold text-amber-300">
                Ficou por fazer
                <span className="rounded-full bg-amber-500 px-2 text-xs leading-5 text-slate-950">{pendentes.length}</span>
              </h2>
              <p className="mb-2.5 mt-0.5 text-xs text-amber-200/70">
                Tarefas de dias anteriores que ainda não foram marcadas como feitas.
              </p>
              <ul className="space-y-2">
                {pendentes.map((it) =>
                  cartao(it, { origem: `de ${rotuloDia(dataDoDia(it.dia))}`, mostrarSetor: true }),
                )}
              </ul>
            </section>
          )}

          <div className="flex items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-extrabold">
              {rotuloDia(diaEscolhido)}
              {dataLocal(diaEscolhido) === hojeIso && (
                <span className="rounded-full bg-red-600 px-2 text-[10px] font-black uppercase leading-5 text-white">
                  hoje
                </span>
              )}
            </h2>
            {contagemDoDia.total > 0 && (
              <span className="text-sm font-semibold text-slate-400">
                {contagemDoDia.feitas}/{contagemDoDia.total} feitas
              </span>
            )}
          </div>

          {secoesDoDia.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-10 text-center">
              <p className="text-sm text-slate-500">
                Nada planejado para este dia{filtroSetor !== 'todos' ? ' neste setor' : ''}.
              </p>
              {podeGerenciar && (
                <button
                  onClick={abrirForm}
                  className="mt-3 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800"
                >
                  + Adicionar tarefa neste dia
                </button>
              )}
            </div>
          ) : (
            secoesDoDia.map((s) => {
              const c = contar(s.itens)
              const tudoFeito = c.feitas === c.total
              return (
                <section key={s.chave} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
                  <header
                    className="flex items-center justify-between gap-2 px-4 py-2.5"
                    style={{ borderTop: `4px solid ${s.cor}` }}
                  >
                    <h3 className="text-sm font-extrabold uppercase tracking-wide" style={{ color: s.cor }}>
                      {s.nome}
                    </h3>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        tudoFeito ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {tudoFeito ? '✓ Tudo feito' : `${c.feitas}/${c.total} feitas`}
                    </span>
                  </header>
                  <ul className="space-y-2 px-3 pb-3">{s.itens.map((it) => cartao(it))}</ul>
                </section>
              )
            })
          )}
        </>
      )}
    </div>
  )
}
