import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import StatCard from '../components/StatCard'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useConfig } from '../hooks/useConfig'
import { useEtapas } from '../hooks/useEtapas'
import { usePedidos } from '../hooks/usePedidos'
import { supabase } from '../lib/supabase'
import { hojeISO } from '../utils/tempo'

const DIAS_GRAFICO = 30

const NOME_FLUXO: Record<string, string> = {
  producao: 'Produção',
  criacao: 'Criação',
  caneca: 'Canecas',
}

interface MovEtapa {
  etapa_id: string
  pedido_id: string
  entrada: string
  saida: string | null
  pedido: { quantidade: number } | null
}

/**
 * Capacidade da Produção: geral (peças concluídas/dia) ou POR ETAPA — o
 * seletor no canto superior direito escolhe a etapa; a capacidade dela é
 * configurável ali mesmo (salva na própria etapa, em peças/dia).
 */
export default function Capacidade() {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const { pedidos } = usePedidos()
  const { etapas, recarregar: recarregarEtapas } = useEtapas()
  const { capacidadeDiaria, metaDiaria, salvar } = useConfig()
  const [etapaSel, setEtapaSel] = useState('') // '' = geral (produção completa)
  const [movs, setMovs] = useState<MovEtapa[]>([])
  const [novaCapacidade, setNovaCapacidade] = useState('')
  const [novaMeta, setNovaMeta] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [dropOpen, setDropOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dropOpen) return
    const fechar = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false)
    }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [dropOpen])

  const etapa = etapas.find((e) => e.id === etapaSel) ?? null
  const etapasAtivasTodas = etapas.filter((e) => e.ativo)
  // valores em vigor (da etapa selecionada ou os gerais)
  // capacidade = teto (máx/dia); meta = alvo diário
  const capacidade = etapa ? etapa.capacidade || 0 : capacidadeDiaria
  const meta = etapa ? etapa.meta || 0 : metaDiaria
  // última etapa do fluxo nunca tem saída — conta quem chega nela
  const ultimaDoFluxo =
    !!etapa &&
    etapa.ordem >= Math.max(...etapasAtivasTodas.filter((e) => e.fluxo === etapa.fluxo).map((e) => e.ordem))

  // movimentações da etapa selecionada nos últimos 30 dias (entrada OU saída na janela)
  useEffect(() => {
    if (!etapaSel) {
      setMovs([])
      return
    }
    const inicio = new Date()
    inicio.setDate(inicio.getDate() - (DIAS_GRAFICO - 1))
    inicio.setHours(0, 0, 0, 0)
    const iso = inicio.toISOString()
    const carregar = async () => {
      const { data } = await supabase
        .from('historico')
        .select('etapa_id, pedido_id, entrada, saida, pedido:pedidos(quantidade)')
        .eq('etapa_id', etapaSel)
        .or(`entrada.gte.${iso},saida.gte.${iso}`)
      setMovs((data as unknown as MovEtapa[]) ?? [])
    }
    carregar()
    const canal = supabase
      .channel(`cap-etapa-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'historico' }, carregar)
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [etapaSel])

  const dados = useMemo(() => {
    const hoje = hojeISO()

    // por dia: pedidos/peças que ENTRARAM e que CONCLUÍRAM (pedidos únicos)
    const entradas = new Map<string, Map<string, number>>()
    const saidas = new Map<string, Map<string, number>>()
    const add = (mapa: Map<string, Map<string, number>>, dia: string, pedidoId: string, qtd: number) => {
      const doDia = mapa.get(dia) ?? new Map<string, number>()
      doDia.set(pedidoId, qtd)
      mapa.set(dia, doDia)
    }

    if (etapa) {
      // modo ETAPA: cada pedido conta UMA vez por etapa — usa a PRIMEIRA
      // entrada e a PRIMEIRA saída dele nesta etapa (evita recontagem em
      // idas e voltas), atribuídas ao dia em que aconteceram.
      const primeiraEntrada = new Map<string, { ts: string; qtd: number }>()
      const primeiraSaida = new Map<string, { ts: string; qtd: number }>()
      for (const m of movs) {
        const qtd = m.pedido?.quantidade ?? 0
        const e = primeiraEntrada.get(m.pedido_id)
        if (!e || m.entrada < e.ts) primeiraEntrada.set(m.pedido_id, { ts: m.entrada, qtd })
        if (m.saida) {
          const s = primeiraSaida.get(m.pedido_id)
          if (!s || m.saida < s.ts) primeiraSaida.set(m.pedido_id, { ts: m.saida, qtd })
        }
      }
      for (const [pid, v] of primeiraEntrada) add(entradas, v.ts.slice(0, 10), pid, v.qtd)
      for (const [pid, v] of primeiraSaida) add(saidas, v.ts.slice(0, 10), pid, v.qtd)
    } else {
      // modo GERAL: pedidos criados x concluídos
      for (const p of pedidos) {
        if (p.status === 'cancelado') continue
        add(entradas, p.created_at.slice(0, 10), p.id, p.quantidade || 0)
        if (p.concluido_em) add(saidas, p.concluido_em.slice(0, 10), p.id, p.quantidade || 0)
      }
    }

    // na última etapa do fluxo, "produzidas" = chegadas (nunca há saída)
    const producaoDia = ultimaDoFluxo ? entradas : saidas

    const somar = (m: Map<string, number> | undefined) =>
      m ? [...m.values()].reduce((a, b) => a + b, 0) : 0
    const contar = (m: Map<string, number> | undefined) => m?.size ?? 0

    const hojeRecebidosPedidos = contar(entradas.get(hoje))
    const hojeProduzidas = somar(producaoDia.get(hoje))
    const pct = capacidade > 0 ? Math.round((hojeProduzidas / capacidade) * 100) : 0
    const restantes = Math.max(0, capacidade - hojeProduzidas)

    const serie: { dia: string; rotulo: string; pedidos: number; produzidas: number; ocupacao: number }[] = []
    for (let i = DIAS_GRAFICO - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const prod = somar(producaoDia.get(iso))
      serie.push({
        dia: iso,
        rotulo: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
        pedidos: contar(entradas.get(iso)),
        produzidas: prod,
        ocupacao: capacidade > 0 ? Math.round((prod / capacidade) * 100) : 0,
      })
    }

    const diasComMovimento = serie.filter((s) => s.produzidas > 0 || s.pedidos > 0)
    const diasAcima = serie.filter((s) => s.ocupacao > 100)
    const diasAbaixo = diasComMovimento.filter((s) => s.ocupacao <= 100).length
    const mediaDiariaPedidos = diasComMovimento.length
      ? diasComMovimento.reduce((a, s) => a + s.pedidos, 0) / diasComMovimento.length
      : 0

    return {
      hojeRecebidosPedidos,
      hojeProduzidas,
      pct,
      restantes,
      serie,
      diasAcima,
      diasAbaixo,
      mediaDiariaPedidos,
      mediaSemanal: mediaDiariaPedidos * 7,
      mediaMensal: mediaDiariaPedidos * 30,
    }
  }, [pedidos, movs, etapa, capacidade, ultimaDoFluxo])

  // salva capacidade e/ou meta (campo vazio = mantém o valor atual)
  const salvarConfig = async () => {
    const cap = novaCapacidade.trim() ? Math.max(0, parseInt(novaCapacidade, 10) || 0) : null
    const met = novaMeta.trim() ? Math.max(0, parseInt(novaMeta, 10) || 0) : null
    if (cap == null && met == null) return
    setSalvando(true)
    let erro: string | null = null
    if (etapa) {
      const upd: { capacidade?: number; meta?: number } = {}
      if (cap != null) upd.capacidade = cap
      if (met != null) upd.meta = met
      const { error } = await supabase.from('etapas').update(upd).eq('id', etapa.id)
      erro = error?.message ?? null
      if (!erro) recarregarEtapas()
    } else {
      if (cap != null) erro = await salvar('capacidade_diaria', String(cap))
      if (!erro && met != null) erro = await salvar('meta_diaria', String(met))
    }
    setSalvando(false)
    if (erro) toast(erro, 'erro')
    else {
      toast(etapa ? `Metas de "${etapa.nome}" atualizadas.` : 'Metas gerais atualizadas.', 'sucesso')
      setNovaCapacidade('')
      setNovaMeta('')
    }
  }

  const sobrecarga = dados.pct > 100
  const corBarra = sobrecarga ? 'bg-rose-500' : dados.pct >= 85 ? 'bg-amber-500' : 'bg-emerald-500'
  // progresso em relação à META (o alvo do dia)
  const pctMeta = meta > 0 ? Math.round((dados.hojeProduzidas / meta) * 100) : null
  const metaAtingida = meta > 0 && dados.hojeProduzidas >= meta
  const faltamMeta = Math.max(0, meta - dados.hojeProduzidas)
  // posição do marcador da meta na barra de capacidade
  const posMeta = capacidade > 0 && meta > 0 ? Math.min(100, (meta / capacidade) * 100) : null
  const rotuloProduzidas = etapa
    ? ultimaDoFluxo
      ? 'Peças que chegaram hoje'
      : 'Peças concluídas na etapa hoje'
    : 'Peças produzidas hoje'
  const rotuloRecebidos = etapa ? 'Pedidos que entraram hoje' : 'Pedidos recebidos hoje'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold md:text-2xl">
            Capacidade da Produção
            {etapa && (
              <span className="ml-2 align-middle rounded-full px-3 py-1 text-xs font-medium"
                style={{ background: `${etapa.cor}22`, color: etapa.cor }}>
                {etapa.nome}
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-400">
            Meta: <span className="text-slate-300">{meta > 0 ? `${meta} pç/dia` : '—'}</span>
            {'  ·  '}
            Capacidade: <span className="text-slate-300">{capacidade > 0 ? `${capacidade} pç/dia` : '—'}</span>
            {etapa ? ' (nesta etapa)' : ' (geral)'}
          </p>
        </div>

        {/* Canto superior direito: painel para escolher a etapa e definir a capacidade dela */}
        <div
          className="w-full rounded-xl border bg-slate-900/80 p-3 shadow-lg sm:w-auto"
          style={{ borderColor: etapa ? `${etapa.cor}66` : '#2a3670' }}
        >
          <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
              <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
            </svg>
            Ver capacidade de
          </label>
          <div className="relative" ref={dropRef}>
            <button
              type="button"
              onClick={() => setDropOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 py-2 pl-3 pr-2.5 text-sm font-medium outline-none transition-colors hover:border-slate-600 focus:border-red-500"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: etapa ? etapa.cor : '#6b77ad' }}
              />
              <span className="max-w-[9rem] truncate">
                {etapa
                  ? `${NOME_FLUXO[etapa.fluxo] ?? etapa.fluxo} · ${etapa.ordem}. ${etapa.nome}`
                  : 'Geral · produção completa'}
              </span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${dropOpen ? 'rotate-180' : ''}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {dropOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[19rem] rounded-lg border border-slate-700 bg-slate-950 py-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => { setEtapaSel(''); setNovaCapacidade(''); setDropOpen(false) }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800 ${!etapaSel ? 'font-medium text-red-400' : 'text-slate-300'}`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#6b77ad]" />
                  Geral · produção completa
                </button>
                {etapasAtivasTodas.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => { setEtapaSel(e.id); setNovaCapacidade(''); setDropOpen(false) }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800 ${etapaSel === e.id ? 'font-medium text-red-400' : 'text-slate-300'}`}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e.cor }} />
                    {NOME_FLUXO[e.fluxo] ?? e.fluxo} · {e.ordem}. {e.nome}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Meta (alvo/dia)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={novaMeta}
                    onChange={(e) => setNovaMeta(e.target.value)}
                    placeholder={String(meta || '—')}
                    className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Capacidade (máx/dia)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={novaCapacidade}
                    onChange={(e) => setNovaCapacidade(e.target.value)}
                    placeholder={String(capacidade || '—')}
                    className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500"
                  />
                </label>
              </div>
              <button
                onClick={() => void salvarConfig()}
                disabled={salvando || (!novaCapacidade.trim() && !novaMeta.trim())}
                className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Alerta de sobrecarga */}
      {sobrecarga && (
        <div className="rounded-xl border border-rose-700 bg-rose-950/60 p-4">
          <p className="text-sm font-bold text-rose-300">
            {etapa ? `Etapa "${etapa.nome}" sobrecarregada` : 'Produção sobrecarregada'}: {dados.pct}% da capacidade diária.
          </p>
          <p className="mt-1 text-xs text-rose-200/70">
            {dados.hojeProduzidas} peças hoje para uma capacidade de {capacidade}. Considere
            redistribuir prazos ou reforçar {etapa ? 'esta etapa' : 'a equipe'}.
          </p>
        </div>
      )}

      {/* Painel de hoje */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard titulo={rotuloRecebidos} valor={dados.hojeRecebidosPedidos} cor="text-red-400" />
        <StatCard titulo={rotuloProduzidas} valor={dados.hojeProduzidas} cor="text-emerald-400" />
        <StatCard
          titulo="Meta do dia"
          valor={
            meta > 0 ? (
              <>
                {dados.hojeProduzidas}/{meta}
                <span className="ml-2 text-sm font-medium text-slate-400">({pctMeta}%)</span>
              </>
            ) : (
              '—'
            )
          }
          detalhe={
            meta === 0
              ? 'Defina a meta acima'
              : metaAtingida
                ? 'meta atingida ✓'
                : `faltam ${faltamMeta} para a meta`
          }
          cor={meta === 0 ? 'text-slate-300' : metaAtingida ? 'text-emerald-400' : 'text-amber-400'}
        />
        <StatCard
          titulo="Capacidade"
          valor={capacidade > 0 ? `${dados.pct}%` : '—'}
          detalhe={
            capacidade === 0
              ? 'Defina a capacidade acima'
              : `restam ${dados.restantes} de ${capacidade} pç/dia`
          }
          cor={sobrecarga ? 'text-rose-400' : dados.pct >= 85 ? 'text-amber-400' : 'text-emerald-400'}
        />
      </div>

      {/* Barra de progresso */}
      {capacidade > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">
              Capacidade utilizada hoje{etapa ? ` — ${etapa.nome}` : ''}
            </span>
            <span className={sobrecarga ? 'font-bold text-rose-400' : 'text-slate-400'}>
              {dados.hojeProduzidas}/{capacidade} ({dados.pct}%)
            </span>
          </div>
          {/* barra: preenche até a capacidade; linha branca marca a META */}
          <div className="relative h-3 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-all ${corBarra}`}
              style={{ width: `${Math.min(100, dados.pct)}%` }}
            />
            {posMeta != null && (
              <div
                className="absolute top-0 h-full w-0.5 bg-slate-100"
                style={{ left: `${posMeta}%` }}
                title={`Meta: ${meta}`}
              />
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            {meta > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-0.5 bg-slate-100" /> Meta: {meta} pç
                {metaAtingida && <span className="font-medium text-emerald-400">— atingida</span>}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${corBarra}`} /> Produzido hoje: {dados.hojeProduzidas} pç
            </span>
            <span>Capacidade: {capacidade} pç</span>
          </div>
        </div>
      )}

      {/* Análise (últimos 30 dias) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          titulo="Dias acima da capacidade"
          valor={dados.diasAcima.length}
          detalhe="últimos 30 dias"
          cor={dados.diasAcima.length > 0 ? 'text-rose-400' : 'text-slate-300'}
        />
        <StatCard titulo="Dias dentro da capacidade" valor={dados.diasAbaixo} detalhe="últimos 30 dias" cor="text-emerald-400" />
        <StatCard titulo="Média diária de pedidos" valor={dados.mediaDiariaPedidos.toFixed(1)} cor="text-red-400" />
        <StatCard
          titulo="Média semanal / mensal"
          valor={
            <span className="text-lg">
              {dados.mediaSemanal.toFixed(0)} <span className="text-xs text-slate-500">/ sem</span> ·{' '}
              {dados.mediaMensal.toFixed(0)} <span className="text-xs text-slate-500">/ mês</span>
            </span>
          }
          cor="text-violet-400"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Evolução dos pedidos por dia */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">
            {etapa ? `Pedidos que entraram em ${etapa.nome} por dia` : 'Pedidos recebidos por dia'}
          </h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dados.serie} margin={{ top: 5, right: 5, bottom: 0, left: -25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a2455" />
                <XAxis dataKey="rotulo" tick={{ fill: '#9aa3cc', fontSize: 10 }} interval={4} />
                <YAxis tick={{ fill: '#9aa3cc', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#0b1233', border: '1px solid #2a3670', borderRadius: 8 }}
                  labelStyle={{ color: '#dfe3f2' }}
                />
                <Line type="monotone" dataKey="pedidos" name="Pedidos" stroke="#ec1c24" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Ocupação (% da capacidade) */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">
            Ocupação{etapa ? ` de ${etapa.nome}` : ' da produção'}
            <span className="ml-2 text-xs font-normal text-slate-500">(% da capacidade; vermelho = acima de 100%)</span>
          </h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dados.serie} margin={{ top: 5, right: 5, bottom: 0, left: -25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a2455" />
                <XAxis dataKey="rotulo" tick={{ fill: '#9aa3cc', fontSize: 10 }} interval={4} />
                <YAxis tick={{ fill: '#9aa3cc', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#0b1233', border: '1px solid #2a3670', borderRadius: 8 }}
                  labelStyle={{ color: '#dfe3f2' }}
                  cursor={{ fill: '#1a2455' }}
                  formatter={(v: number) => [`${v}%`, 'Ocupação']}
                />
                <Bar dataKey="ocupacao" name="Ocupação" radius={[4, 4, 0, 0]}>
                  {dados.serie.map((s, i) => (
                    <Cell key={i} fill={s.ocupacao > 100 ? '#f43f5e' : s.ocupacao >= 85 ? '#f59e0b' : '#34d399'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Dias críticos */}
      {dados.diasAcima.length > 0 && (
        <div className="rounded-xl border border-rose-900/60 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold text-rose-300">
            Dias críticos (acima de 100%){etapa ? ` — ${etapa.nome}` : ''}
          </h2>
          <div className="flex flex-wrap gap-2">
            {dados.diasAcima.map((s) => (
              <span key={s.dia} className="rounded-full bg-rose-950 px-3 py-1 text-xs font-medium text-rose-300">
                {s.rotulo} — {s.ocupacao}% ({s.produzidas} peças)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Visão rápida de meta/capacidade de todas as etapas */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-1 text-sm font-semibold">Meta e capacidade por etapa</h2>
        <p className="mb-3 text-xs text-slate-500">meta (alvo) / capacidade (teto) em peças/dia — clique para abrir a etapa</p>
        <div className="flex flex-wrap gap-2">
          {etapasAtivasTodas.map((e) => (
            <button
              key={e.id}
              onClick={() => setEtapaSel(e.id)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                e.id === etapaSel ? 'border-red-500 text-slate-100' : 'border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: e.cor }} />
              {e.nome}: {e.meta > 0 ? e.meta : '—'} / {e.capacidade > 0 ? e.capacidade : '—'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
