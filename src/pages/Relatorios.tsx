import { useEffect, useMemo, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import StatCard from '../components/StatCard'
import { useEtapas } from '../hooks/useEtapas'
import { supabase } from '../lib/supabase'
import type { Historico, Meta, Pedido } from '../types'
import type { TabelaExport } from '../utils/exportar'
import { formatarDuracao } from '../utils/tempo'

type Periodo = 'semana' | 'mes' | 'semestre' | 'ano'

const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mês' },
  { id: 'semestre', label: 'Últimos 6 meses' },
  { id: 'ano', label: 'Este ano' },
]

function inicioDoPeriodo(p: Periodo): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (p === 'semana') {
    const dia = d.getDay() // 0 = domingo
    d.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1)) // segunda-feira
  } else if (p === 'mes') {
    d.setDate(1)
  } else if (p === 'semestre') {
    d.setMonth(d.getMonth() - 6)
  } else {
    d.setMonth(0, 1)
  }
  return d
}

export default function Relatorios() {
  const { etapasAtivas } = useEtapas()
  const [periodo, setPeriodo] = useState<Periodo>('semana')
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [historico, setHistorico] = useState<Historico[]>([])
  const [metas, setMetas] = useState<Meta[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    const inicio = inicioDoPeriodo(periodo).toISOString()
    const inicioData = inicio.slice(0, 10)
    setCarregando(true)
    Promise.all([
      supabase.from('pedidos').select('*, etapa_atual:etapas(*)'),
      supabase
        .from('historico')
        .select('*, etapa:etapas(*), funcionario:profiles(id, nome)')
        .gte('entrada', inicio),
      supabase.from('metas').select('*').gte('data', inicioData),
    ]).then(([p, h, m]) => {
      setPedidos((p.data as Pedido[]) ?? [])
      setHistorico((h.data as Historico[]) ?? [])
      setMetas((m.data as Meta[]) ?? [])
      setCarregando(false)
    })
  }, [periodo])

  const rel = useMemo(() => {
    const inicio = inicioDoPeriodo(periodo)
    const inicioISO = inicio.toISOString()

    const iniciados = pedidos.filter((p) => p.created_at >= inicioISO)
    const concluidos = pedidos.filter((p) => p.concluido_em && p.concluido_em >= inicioISO)
    const emAndamento = pedidos.filter((p) => p.status === 'em_andamento')
    const hoje = new Date().toISOString().slice(0, 10)
    const atrasados = emAndamento.filter((p) => p.data_prevista && p.data_prevista < hoje)

    // produção por etapa: PEDIDOS ÚNICOS com trabalho concluído na etapa.
    // Ir e voltar de etapa gera vários registros no histórico, mas o mesmo
    // pedido só conta uma vez — só cresce com pedidos novos.
    const fechados = historico.filter((h) => h.saida)
    const ultimaOrdem = Math.max(0, ...etapasAtivas.map((e) => e.ordem))
    const porEtapa = etapasAtivas.map((e) => {
      // a última etapa nunca tem saída: conta quem chegou nela (entregues)
      const fonte = e.ordem >= ultimaOrdem ? historico : fechados
      const regs = fonte.filter((h) => h.etapa_id === e.id)
      const pedidosUnicos = new Set(regs.map((r) => r.pedido_id))
      const tempos = regs.map((r) => r.segundos_gastos ?? 0).filter((t) => t > 0)
      const metaEtapa = metas
        .filter((m) => m.etapa_id === e.id)
        .reduce((a, m) => a + m.quantidade, 0)
      return {
        nome: e.nome,
        cor: e.cor,
        qtd: pedidosUnicos.size,
        tempoMedio: tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null,
        meta: metaEtapa,
        pctMeta: metaEtapa > 0 ? Math.round((pedidosUnicos.size / metaEtapa) * 100) : null,
      }
    })

    // funcionário mais produtivo: pedido+etapa únicos (repetir a mesma etapa
    // do mesmo pedido não conta em dobro)
    const porFunc = new Map<string, Set<string>>()
    for (const h of historico) {
      if (!h.funcionario) continue
      const conjunto = porFunc.get(h.funcionario.nome) ?? new Set<string>()
      conjunto.add(`${h.pedido_id}|${h.etapa_id}`)
      porFunc.set(h.funcionario.nome, conjunto)
    }
    const rankFunc = [...porFunc.entries()]
      .map(([nome, conjunto]) => [nome, conjunto.size] as [string, number])
      .sort((a, b) => b[1] - a[1])

    const setorTop = [...porEtapa].sort((a, b) => b.qtd - a.qtd)[0]

    const tempoMedioProducao = concluidos.length
      ? concluidos.reduce(
          (acc, p) => acc + (new Date(p.concluido_em!).getTime() - new Date(p.created_at).getTime()) / 1000,
          0,
        ) / concluidos.length
      : null

    const dias = Math.max(1, Math.ceil((Date.now() - inicio.getTime()) / 86_400_000))
    const mediaDiaria = concluidos.length / dias

    // apenas metas gerais (etapa_id null) — metas de etapa têm comparação própria
    const totalMeta = metas.filter((m) => !m.etapa_id).reduce((a, m) => a + m.quantidade, 0)
    const pctMeta = totalMeta > 0 ? Math.round((concluidos.length / totalMeta) * 100) : null

    // evolução: concluídos por dia (ou por mês em períodos longos)
    const porMes = periodo === 'semestre' || periodo === 'ano'
    const evolucaoMap = new Map<string, number>()
    for (const p of concluidos) {
      const chave = porMes ? p.concluido_em!.slice(0, 7) : p.concluido_em!.slice(0, 10)
      evolucaoMap.set(chave, (evolucaoMap.get(chave) ?? 0) + 1)
    }
    const evolucao = [...evolucaoMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({
        rotulo: porMes
          ? new Date(k + '-02').toLocaleDateString('pt-BR', { month: 'short' })
          : new Date(k + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        concluidos: v,
      }))

    return {
      iniciados: iniciados.length,
      concluidos: concluidos.length,
      emAndamento: emAndamento.length,
      atrasados: atrasados.length,
      porEtapa,
      rankFunc,
      setorTop,
      tempoMedioProducao,
      mediaDiaria,
      pctMeta,
      totalMeta,
      evolucao,
    }
  }, [pedidos, historico, metas, etapasAtivas, periodo])

  const labelPeriodo = PERIODOS.find((p) => p.id === periodo)!.label

  const montarTabelas = (): TabelaExport[] => [
    {
      titulo: 'Produção Geral',
      colunas: ['Indicador', 'Valor'],
      linhas: [
        ['Pedidos iniciados', rel.iniciados],
        ['Pedidos concluídos', rel.concluidos],
        ['Pedidos em andamento', rel.emAndamento],
        ['Pedidos atrasados', rel.atrasados],
        ['Tempo médio de produção', formatarDuracao(rel.tempoMedioProducao)],
        ['Média diária de produção', rel.mediaDiaria.toFixed(1)],
        ['Meta do período', rel.totalMeta || '—'],
        ['Meta atingida', rel.pctMeta != null ? `${rel.pctMeta}%` : '—'],
        ['Funcionário mais produtivo', rel.rankFunc[0]?.[0] ?? '—'],
        ['Setor mais produtivo', rel.setorTop?.nome ?? '—'],
      ],
    },
    {
      titulo: 'Produção por Etapa',
      colunas: ['Etapa', 'Quantidade realizada', 'Meta', 'Meta atingida', 'Tempo médio'],
      linhas: rel.porEtapa.map((e) => [
        e.nome,
        e.qtd,
        e.meta || '—',
        e.pctMeta != null ? `${e.pctMeta}%` : '—',
        formatarDuracao(e.tempoMedio),
      ]),
    },
    {
      titulo: 'Produção por Funcionário',
      colunas: ['Funcionário', 'Etapas movimentadas'],
      linhas: rel.rankFunc.map(([nome, qtd]) => [nome, qtd]),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold md:text-2xl">Relatórios</h1>
          <p className="text-sm text-slate-400">{labelPeriodo}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              const { exportarPDF } = await import('../utils/exportar')
              exportarPDF(`relatorio-${periodo}`, labelPeriodo, montarTabelas())
            }}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium hover:bg-slate-800"
          >
            ⬇ PDF
          </button>
          <button
            onClick={async () => {
              const { exportarExcel } = await import('../utils/exportar')
              exportarExcel(`relatorio-${periodo}`, montarTabelas())
            }}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium hover:bg-slate-800"
          >
            ⬇ Excel
          </button>
        </div>
      </div>

      {/* Filtro de período */}
      <div className="flex flex-wrap gap-2">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriodo(p.id)}
            className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${
              periodo === p.id
                ? 'bg-sky-600 text-white'
                : 'border border-slate-700 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {carregando ? (
        <div className="flex justify-center py-20">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        </div>
      ) : (
        <>
          {/* Produção geral */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard titulo="Iniciados" valor={rel.iniciados} cor="text-sky-400" />
            <StatCard titulo="Concluídos" valor={rel.concluidos} cor="text-emerald-400" />
            <StatCard titulo="Em andamento" valor={rel.emAndamento} cor="text-violet-400" />
            <StatCard titulo="Atrasados" valor={rel.atrasados} cor={rel.atrasados > 0 ? 'text-rose-400' : 'text-slate-300'} />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard titulo="Tempo médio de produção" valor={formatarDuracao(rel.tempoMedioProducao)} cor="text-amber-400" />
            <StatCard titulo="Média diária" valor={rel.mediaDiaria.toFixed(1)} detalhe="pedidos/dia" cor="text-sky-400" />
            <StatCard
              titulo="Meta atingida"
              valor={rel.pctMeta != null ? `${rel.pctMeta}%` : '—'}
              detalhe={rel.totalMeta ? `${rel.concluidos} de ${rel.totalMeta}` : 'Sem metas no período'}
              cor="text-violet-400"
            />
            <StatCard
              titulo="Mais produtivo"
              valor={<span className="text-base">{rel.rankFunc[0]?.[0] ?? '—'}</span>}
              detalhe={rel.setorTop ? `Setor destaque: ${rel.setorTop.nome}` : undefined}
              cor="text-emerald-400"
            />
          </div>

          {/* Evolução */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-sm font-semibold">Evolução da produção (concluídos)</h2>
            <div className="h-56">
              {rel.evolucao.length === 0 ? (
                <p className="py-16 text-center text-sm text-slate-500">Sem conclusões no período.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={rel.evolucao} margin={{ top: 5, right: 5, bottom: 0, left: -25 }}>
                    <defs>
                      <linearGradient id="gradProd" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="rotulo" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                      labelStyle={{ color: '#e2e8f0' }}
                    />
                    <Area type="monotone" dataKey="concluidos" name="Concluídos" stroke="#38bdf8" fill="url(#gradProd)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Produção por etapa */}
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-3 text-sm font-semibold">Produção por etapa</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rel.porEtapa} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="nome" width={90} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                      labelStyle={{ color: '#e2e8f0' }}
                      cursor={{ fill: '#1e293b' }}
                    />
                    <Bar dataKey="qtd" name="Realizadas" radius={[0, 6, 6, 0]}>
                      {rel.porEtapa.map((e, i) => (
                        <Cell key={i} fill={e.cor} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tempo médio por etapa */}
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-3 text-sm font-semibold">Tempo médio por etapa</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                    <th className="pb-2 font-medium">Etapa</th>
                    <th className="pb-2 text-right font-medium">Realizadas</th>
                    <th className="pb-2 text-right font-medium">Meta</th>
                    <th className="pb-2 text-right font-medium">Tempo médio</th>
                  </tr>
                </thead>
                <tbody>
                  {rel.porEtapa.map((e) => (
                    <tr key={e.nome} className="border-b border-slate-800/50">
                      <td className="py-2">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: e.cor }} />
                        {e.nome}
                      </td>
                      <td className="py-2 text-right font-medium">{e.qtd}</td>
                      <td className="py-2 text-right">
                        {e.meta > 0 ? (
                          <span className={e.pctMeta! >= 100 ? 'font-medium text-emerald-400' : 'text-slate-300'}>
                            {e.meta} ({e.pctMeta}%)
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="py-2 text-right text-slate-400">{formatarDuracao(e.tempoMedio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Ranking de funcionários */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-sm font-semibold">Produção por funcionário</h2>
            {rel.rankFunc.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">Sem movimentações no período.</p>
            ) : (
              <div className="space-y-2.5">
                {rel.rankFunc.map(([nome, qtd], i) => (
                  <div key={nome}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-medium text-slate-300">
                        {i === 0 && '🏆 '}
                        {nome}
                      </span>
                      <span className="text-slate-500">{qtd} etapas</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${(qtd / (rel.rankFunc[0]?.[1] || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
