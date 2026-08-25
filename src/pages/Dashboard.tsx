import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import StatCard from '../components/StatCard'
import { useAuth } from '../contexts/AuthContext'
import { useEtapas } from '../hooks/useEtapas'
import { usePedidos } from '../hooks/usePedidos'
import { supabase } from '../lib/supabase'
import type { Historico, Meta, Profile } from '../types'
import { pecasPorPedido, somarPecas, type FichaContagem } from '../utils/corte'
import { formatarDataHora, formatarDuracao, hojeISO } from '../utils/tempo'

export default function Dashboard() {
  const { profile } = useAuth()
  const { pedidos } = usePedidos()
  const { etapasAtivas, etapasDoFluxo } = useEtapas()
  const [historicoHoje, setHistoricoHoje] = useState<Historico[]>([])
  const [saidasHoje, setSaidasHoje] = useState<Historico[]>([])
  const [historicoRecente, setHistoricoRecente] = useState<Historico[]>([])
  const [metasHoje, setMetasHoje] = useState<Meta[]>([])
  const [funcionarios, setFuncionarios] = useState<Profile[]>([])
  // grades das fichas técnicas: base da contagem de peças produzidas
  const [fichas, setFichas] = useState<FichaContagem[]>([])

  const carregarExtras = async () => {
    const inicioHoje = new Date()
    inicioHoje.setHours(0, 0, 0, 0)

    const [hHoje, hSaidas, hRecente, m, funcs, fic] = await Promise.all([
      // só as colunas usadas nos cálculos (menos banda; histórico cresce muito)
      supabase
        .from('historico')
        .select('entrada, etapa_id, pedido_id, funcionario:profiles(id, nome)')
        .gte('entrada', inicioHoje.toISOString()),
      // etapas finalizadas hoje (a entrada pode ter sido em dias anteriores)
      supabase
        .from('historico')
        .select('etapa_id, pedido_id, saida')
        .gte('saida', inicioHoje.toISOString()),
      supabase
        .from('historico')
        .select('*, etapa:etapas(*), funcionario:profiles(id, nome), pedido:pedidos(id, numero, cliente)')
        .order('entrada', { ascending: false })
        .limit(12),
      supabase.from('metas').select('*').eq('data', hojeISO()),
      supabase.from('profiles').select('*').eq('ativo', true),
      supabase.from('fichas_tecnicas').select('pedido_id, grade'),
    ])
    setHistoricoHoje((hHoje.data as unknown as Historico[]) ?? [])
    setSaidasHoje((hSaidas.data as Historico[]) ?? [])
    setHistoricoRecente((hRecente.data as Historico[]) ?? [])
    setMetasHoje((m.data as Meta[]) ?? [])
    setFuncionarios((funcs.data as Profile[]) ?? [])
    setFichas((fic.data as FichaContagem[]) ?? [])
  }

  useEffect(() => {
    carregarExtras()
    const canal = supabase
      .channel(`dash-rt-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'historico' }, carregarExtras)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'metas' }, carregarExtras)
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [])

  const stats = useMemo(() => {
    const hoje = hojeISO()
    const emAndamento = pedidos.filter((p) => p.status === 'em_andamento')
    const concluidosHoje = pedidos.filter(
      (p) => p.status === 'concluido' && p.concluido_em && p.concluido_em.slice(0, 10) === hoje,
    )
    const atrasados = emAndamento.filter((p) => p.data_prevista && p.data_prevista < hoje)

    const concluidos = pedidos.filter((p) => p.status === 'concluido' && p.concluido_em)

    // Peças produzidas: soma as grades das fichas técnicas dos pedidos
    // concluídos. Um pedido rende N camisas, então contar pedidos não
    // mostra o volume real de produção.
    const porPedido = pecasPorPedido(fichas)
    const pecasHoje = somarPecas(concluidosHoje, porPedido)
    const pecasTotal = somarPecas(concluidos, porPedido)
    // pedidos concluídos que ainda não têm ficha: o total sai subestimado
    const semFicha = concluidos.filter((p) => !porPedido.has(p.id)).length
    const tempoMedioProducao =
      concluidos.length > 0
        ? concluidos.reduce(
            (acc, p) => acc + (new Date(p.concluido_em!).getTime() - new Date(p.created_at).getTime()) / 1000,
            0,
          ) / concluidos.length
        : null

    const porEtapa = etapasAtivas.map((e) => ({
      nome: e.nome,
      cor: e.cor,
      qtd: emAndamento.filter((p) => p.etapa_atual_id === e.id).length,
    }))

    // produção por funcionário hoje: pedido+etapa únicos — mover o mesmo
    // pedido de volta para uma etapa já contada não soma em dobro
    const porFuncionario = new Map<string, { nome: string; combos: Set<string> }>()
    for (const h of historicoHoje) {
      if (!h.funcionario) continue
      const atual = porFuncionario.get(h.funcionario.id) ?? { nome: h.funcionario.nome, combos: new Set<string>() }
      atual.combos.add(`${h.pedido_id}|${h.etapa_id}`)
      porFuncionario.set(h.funcionario.id, atual)
    }
    const producaoFuncionarios = [...porFuncionario.values()]
      .map((f) => ({ nome: f.nome, qtd: f.combos.size }))
      .sort((a, b) => b.qtd - a.qtd)
      .slice(0, 8)

    // Peças que passaram por cada etapa HOJE — "quanto foi cortado, prensado,
    // costurado no dia". Usa quem SAIU da etapa (trabalho terminado); na
    // última etapa não há saída, então conta quem chegou nela.
    // Só as etapas marcadas em Admin → Fluxo: etapas de espera não são produção.
    const ultimaOrdemEtapa = Math.max(0, ...etapasAtivas.map((e) => e.ordem))
    const pecasPorEtapaHoje = etapasAtivas
      .filter((e) => e.conta_pecas)
      .map((e) => {
        const fonte = e.ordem >= ultimaOrdemEtapa ? historicoHoje : saidasHoje
        const ids = new Set(fonte.filter((h) => h.etapa_id === e.id).map((h) => h.pedido_id))
        return {
          nome: e.nome,
          cor: e.cor,
          pedidos: ids.size,
          pecas: [...ids].reduce((a, id) => a + (porPedido.get(id) ?? 0), 0),
        }
      })

    // Artes e canecas do dia (as outras duas abas).
    // A arte conta quando o pedido CHEGOU hoje na última etapa do fluxo de
    // criação. Não dá para usar o marcador "arte pronta" do card: ele não
    // guarda data, então contaria o acumulado de todos os tempos.
    const etapasCriacao = etapasDoFluxo('criacao')
    const finalCriacao = etapasCriacao.reduce<(typeof etapasCriacao)[number] | null>(
      (maior, e) => (!maior || e.ordem > maior.ordem ? e : maior),
      null,
    )
    const artesHoje = finalCriacao
      ? new Set(
          historicoHoje.filter((h) => h.etapa_id === finalCriacao.id).map((h) => h.pedido_id),
        ).size
      : 0
    const canecasHoje = concluidosHoje
      .filter((p) => (p.tipo ?? 'pronto') === 'caneca')
      .reduce((a, p) => a + (p.quantidade || 0), 0)

    const metaQtd = metasHoje.find((m) => !m.etapa_id)?.quantidade ?? 0
    const pctMeta = metaQtd > 0 ? Math.round((concluidosHoje.length / metaQtd) * 100) : null

    // metas por etapa: "feitas" = pedidos únicos que saíram da etapa hoje;
    // na última etapa não há saída, então conta quem chegou nela (entregues)
    const ultimaOrdem = Math.max(0, ...etapasAtivas.map((e) => e.ordem))
    const metasEtapas: { etapa: (typeof etapasAtivas)[number]; meta: number; feitas: number; pct: number }[] = []
    for (const m of metasHoje) {
      if (!m.etapa_id) continue
      const etapa = etapasAtivas.find((e) => e.id === m.etapa_id)
      if (!etapa) continue
      const fonte = etapa.ordem >= ultimaOrdem ? historicoHoje : saidasHoje
      const feitas = new Set(
        fonte.filter((h) => h.etapa_id === etapa.id).map((h) => h.pedido_id),
      ).size
      metasEtapas.push({
        etapa,
        meta: m.quantidade,
        feitas,
        pct: m.quantidade > 0 ? Math.round((feitas / m.quantidade) * 100) : 0,
      })
    }
    metasEtapas.sort((a, b) => a.etapa.ordem - b.etapa.ordem)

    return {
      emAndamento: emAndamento.length,
      concluidosHoje: concluidosHoje.length,
      atrasados: atrasados.length,
      tempoMedioProducao,
      porEtapa,
      porFuncionario: producaoFuncionarios,
      metaQtd,
      pctMeta,
      metasEtapas,
      pecasHoje,
      pecasTotal,
      semFicha,
      pecasPorEtapaHoje,
      artesHoje,
      canecasHoje,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos, etapasAtivas, historicoHoje, saidasHoje, metasHoje, fichas])

  // linha do tempo: movimentações de etapa + cancelamentos, mais recentes primeiro
  const eventos = useMemo(() => {
    const movs = historicoRecente.map((h) => ({ tipo: 'mov' as const, quando: h.entrada, h }))
    const cancelamentos = pedidos
      .filter((p) => p.status === 'cancelado' && p.cancelado_em)
      .map((p) => ({ tipo: 'cancelamento' as const, quando: p.cancelado_em!, p }))
    return [...movs, ...cancelamentos]
      .sort((a, b) => b.quando.localeCompare(a.quando))
      .slice(0, 12)
  }, [historicoRecente, pedidos])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">Olá, {profile?.nome?.split(' ')[0]}</h1>
        <p className="text-sm text-slate-400">Acompanhamento da produção em tempo real</p>
      </div>

      {/* Cards principais */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard titulo="Em andamento" valor={stats.emAndamento} cor="text-red-400" />
        <StatCard titulo="Concluídos hoje" valor={stats.concluidosHoje} cor="text-emerald-400" />
        <StatCard
          titulo="Meta diária"
          valor={
            stats.metaQtd > 0 ? (
              <>
                {stats.concluidosHoje}/{stats.metaQtd}
                <span className="ml-2 text-sm font-medium text-slate-400">({stats.pctMeta}%)</span>
              </>
            ) : (
              '—'
            )
          }
          detalhe={stats.metaQtd === 0 ? 'Nenhuma meta definida para hoje' : undefined}
          cor="text-violet-400"
        />
        <StatCard
          titulo="Atrasados"
          valor={stats.atrasados}
          cor={stats.atrasados > 0 ? 'text-rose-400' : 'text-slate-300'}
        />
        <StatCard
          titulo="Peças produzidas hoje"
          valor={stats.pecasHoje}
          detalhe={`${stats.pecasTotal} no total`}
          cor="text-sky-400"
        />
      </div>

      {/* Sem ficha técnica a contagem sai por baixo — avisa em vez de mentir */}
      {stats.semFicha > 0 && (
        <p className="text-xs text-amber-400">
          ⚠️ {stats.semFicha} pedido(s) concluído(s) sem ficha técnica — as peças deles não entram
          na contagem.
        </p>
      )}

      {/* Quanto foi cortado, prensado, costurado… hoje */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Peças por etapa hoje</h2>
          <div className="flex gap-4 text-xs">
            <span className="text-slate-500">
              Artes prontas <span className="font-bold text-fuchsia-400">{stats.artesHoje}</span>
            </span>
            <span className="text-slate-500">
              Canecas hoje <span className="font-bold text-orange-400">{stats.canecasHoje}</span>
            </span>
          </div>
        </div>
        {stats.pecasPorEtapaHoje.length === 0 && (
          <p className="py-4 text-center text-xs text-slate-500">
            Nenhuma etapa marcada para contar peças. Marque em Admin → Fluxo.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {stats.pecasPorEtapaHoje.map((e) => (
            <div
              key={e.nome}
              className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
              style={{ borderLeft: `3px solid ${e.cor}` }}
            >
              <p className="truncate text-xs text-slate-400">{e.nome}</p>
              <p className={`mt-1 text-xl font-bold ${e.pecas > 0 ? 'text-sky-400' : 'text-slate-600'}`}>
                {e.pecas}
              </p>
              <p className="text-[11px] text-slate-600">
                {e.pedidos} {e.pedidos === 1 ? 'pedido' : 'pedidos'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Barra de progresso da meta */}
      {stats.metaQtd > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Progresso da meta de hoje</span>
            <span className="text-slate-400">{stats.pctMeta}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-red-700 to-red-400 transition-all"
              style={{ width: `${Math.min(100, stats.pctMeta ?? 0)}%` }}
            />
          </div>
        </div>
      )}

      {/* Metas por etapa (hoje) */}
      {stats.metasEtapas.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">Metas por etapa (hoje)</h2>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {stats.metasEtapas.map(({ etapa, meta, feitas, pct }) => (
              <div key={etapa.id}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-slate-300">
                    <span className="h-2 w-2 rounded-full" style={{ background: etapa.cor }} />
                    {etapa.nome}
                  </span>
                  <span className={pct >= 100 ? 'font-semibold text-emerald-400' : 'text-slate-400'}>
                    {feitas}/{meta} ({pct}%){pct >= 100 && ' ✓'}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, pct)}%`, background: etapa.cor }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pedidos por etapa */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">Pedidos em cada etapa</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.porEtapa} margin={{ top: 5, right: 5, bottom: 5, left: -25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a2455" />
                <XAxis
                  dataKey="nome"
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={60}
                />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#0b1233', border: '1px solid #2a3670', borderRadius: 8 }}
                  labelStyle={{ color: '#e2e8f0' }}
                  cursor={{ fill: '#1a2455' }}
                />
                <Bar dataKey="qtd" name="Pedidos" radius={[6, 6, 0, 0]}>
                  {stats.porEtapa.map((e, i) => (
                    <Cell key={i} fill={e.cor} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Produção por funcionário */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">
            Produção por funcionário (hoje)
            <span className="ml-2 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-normal text-slate-400">
              {funcionarios.length} ativos
            </span>
          </h2>
          {stats.porFuncionario.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Nenhuma movimentação hoje.</p>
          ) : (
            <div className="space-y-2.5">
              {stats.porFuncionario.map((f) => {
                const max = stats.porFuncionario[0]?.qtd || 1
                return (
                  <div key={f.nome}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-medium text-slate-300">{f.nome}</span>
                      <span className="text-slate-500">{f.qtd} etapas</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-red-500"
                        style={{ width: `${(f.qtd / max) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Indicadores */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">Indicadores</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-400">Tempo médio de produção</dt>
              <dd className="font-semibold">{formatarDuracao(stats.tempoMedioProducao)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Total de pedidos</dt>
              <dd className="font-semibold">{pedidos.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Concluídos (total)</dt>
              <dd className="font-semibold">{pedidos.filter((p) => p.status === 'concluido').length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Movimentações hoje</dt>
              <dd className="font-semibold">{historicoHoje.length}</dd>
            </div>
          </dl>
        </div>

        {/* Linha do tempo */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Linha do tempo da produção</h2>
          {eventos.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Sem movimentações ainda.</p>
          ) : (
            <ol className="relative space-y-4 border-l border-slate-800 pl-5">
              {eventos.map((e) =>
                e.tipo === 'mov' ? (
                  <li key={`mov-${e.h.id}`} className="relative">
                    <span
                      className="absolute -left-[26px] top-1.5 h-3 w-3 rounded-full border-2 border-slate-900"
                      style={{ background: e.h.etapa?.cor ?? '#ec1c24' }}
                    />
                    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <Link
                        to={`/pedidos/${e.h.pedido?.numero ?? ''}`}
                        className="font-semibold text-red-400 hover:underline"
                      >
                        #{e.h.pedido?.numero}
                      </Link>
                      <span className="text-slate-300">→ {e.h.etapa?.nome}</span>
                      {e.h.via_voz && (
                        <span
                          title="Via comando de voz"
                          className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400"
                        >
                          voz
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {e.h.funcionario?.nome ?? 'Sistema'} • {formatarDataHora(e.h.entrada)}
                    </p>
                  </li>
                ) : (
                  <li key={`cancel-${e.p.id}`} className="relative">
                    <span className="absolute -left-[26px] top-1.5 h-3 w-3 rounded-full border-2 border-slate-900 bg-rose-500" />
                    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <Link
                        to={`/pedidos/${e.p.numero}`}
                        className="font-semibold text-red-400 hover:underline"
                      >
                        #{e.p.numero}
                      </Link>
                      <span className="font-medium text-rose-400">✕ Pedido cancelado</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {e.p.cliente} • {formatarDataHora(e.p.cancelado_em)}
                    </p>
                  </li>
                ),
              )}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
