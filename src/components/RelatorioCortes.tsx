import { useEffect, useMemo, useState } from 'react'
import StatCard from './StatCard'
import { useToast } from '../contexts/ToastContext'
import { supabase } from '../lib/supabase'
import type { Grade, LoteCorte, ResumoCorte } from '../types'
import { gradeEmLinhas } from '../utils/corte'
import { formatarDataHora } from '../utils/tempo'

type Periodo = 'semana' | 'mes' | 'ano' | 'tudo'
const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mês' },
  { id: 'ano', label: 'Este ano' },
  { id: 'tudo', label: 'Tudo' },
]

function inicioDoPeriodo(p: Periodo): Date | null {
  if (p === 'tudo') return null
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (p === 'semana') {
    const dia = d.getDay()
    d.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1))
  } else if (p === 'mes') d.setDate(1)
  else d.setMonth(0, 1)
  return d
}

const temResumo = (l: LoteCorte): l is LoteCorte & { resumo: ResumoCorte } =>
  Boolean(l.resumo && 'modelagens' in l.resumo)

/**
 * Relatório de pedidos cortados: lê os lotes já concluídos e mostra o que
 * foi cortado (pedidos, modelagens, grades e total de pares), por período.
 * Cada unidade = 1 par (frente + costa).
 */
export default function RelatorioCortes() {
  const toast = useToast()
  const [lotes, setLotes] = useState<LoteCorte[]>([])
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [aberto, setAberto] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    const carregar = async () => {
      setCarregando(true)
      const inicio = inicioDoPeriodo(periodo)
      let q = supabase
        .from('lotes_corte')
        .select('*')
        .not('finalizado_em', 'is', null)
        .order('finalizado_em', { ascending: false })
        .limit(200)
      if (inicio) q = q.gte('finalizado_em', inicio.toISOString())
      const [lt, pf] = await Promise.all([q, supabase.from('profiles').select('id, nome')])
      if (lt.error) toast(lt.error.message, 'erro')
      setLotes((lt.data as LoteCorte[]) ?? [])
      const mapa: Record<string, string> = {}
      for (const p of ((pf.data ?? []) as { id: string; nome: string }[])) mapa[p.id] = p.nome
      setNomes(mapa)
      setCarregando(false)
    }
    void carregar()
  }, [periodo, toast])

  const rel = useMemo(() => {
    const comResumo = lotes.filter(temResumo)
    const totalPares = comResumo.reduce((a, l) => a + (l.resumo.totalPares || 0), 0)
    const totalPedidos = comResumo.reduce((a, l) => a + (l.resumo.pedidos?.length ?? 0), 0)

    // soma por modelagem no período (junta todos os lotes)
    const porModelagem = new Map<string, { total: number; grade: Grade }>()
    for (const l of comResumo) {
      for (const m of l.resumo.modelagens ?? []) {
        const chave = m.modelagem.toUpperCase()
        const atual = porModelagem.get(chave) ?? { total: 0, grade: {} }
        atual.total += m.total || 0
        for (const [tam, qtd] of Object.entries(m.grade ?? {})) {
          atual.grade[tam] = (atual.grade[tam] ?? 0) + (Number(qtd) || 0)
        }
        porModelagem.set(chave, atual)
      }
    }
    const modelagens = [...porModelagem.entries()]
      .map(([modelagem, v]) => ({ modelagem, ...v }))
      .sort((a, b) => b.total - a.total)

    return { comResumo, totalPares, totalPedidos, modelagens }
  }, [lotes])

  const exportar = async (formato: 'pdf' | 'excel') => {
    const { exportarPDF, exportarExcel } = await import('../utils/exportar')
    const label = PERIODOS.find((p) => p.id === periodo)!.label
    const tabelas = [
      {
        titulo: 'Resumo dos Cortes',
        colunas: ['Indicador', 'Valor'],
        linhas: [
          ['Lotes cortados', rel.comResumo.length],
          ['Pedidos cortados', rel.totalPedidos],
          ['Total de pares', rel.totalPares],
        ] as (string | number)[][],
      },
      {
        titulo: 'Cortado por Modelagem',
        colunas: ['Modelagem', 'Pares', 'Grade'],
        linhas: rel.modelagens.map((m) => [
          m.modelagem,
          m.total,
          gradeEmLinhas(m.grade).map((l) => `${l.tamanho}:${l.qtd}`).join('  '),
        ]),
      },
      {
        titulo: 'Lotes',
        colunas: ['Concluído em', 'Responsável', 'Pedidos', 'Pares'],
        linhas: rel.comResumo.map((l) => [
          formatarDataHora(l.finalizado_em),
          (l.finalizado_por && nomes[l.finalizado_por]) || '—',
          (l.resumo.pedidos ?? []).map((p) => `#${p.numero}`).join(', '),
          l.resumo.totalPares || 0,
        ]),
      },
    ]
    if (formato === 'pdf') exportarPDF(`cortes-${periodo}`, label, tabelas)
    else exportarExcel(`cortes-${periodo}`, tabelas)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold">Relatório de pedidos cortados</h2>
        {rel.comResumo.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={() => void exportar('pdf')}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium hover:bg-slate-800"
            >
              ↓ PDF
            </button>
            <button
              onClick={() => void exportar('excel')}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium hover:bg-slate-800"
            >
              ↓ Excel
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriodo(p.id)}
            className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${
              periodo === p.id
                ? 'bg-red-600 text-white'
                : 'border border-slate-700 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {carregando ? (
        <div className="flex justify-center py-10">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
        </div>
      ) : rel.comResumo.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">
          Nenhum corte concluído neste período.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard titulo="Lotes cortados" valor={rel.comResumo.length} cor="text-red-400" />
            <StatCard titulo="Pedidos cortados" valor={rel.totalPedidos} cor="text-violet-400" />
            <StatCard titulo="Pares cortados" valor={rel.totalPares} cor="text-emerald-400" />
          </div>

          {/* soma por modelagem no período */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-3 text-sm font-semibold">Cortado por modelagem</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                  <th className="pb-2 font-medium">Modelagem</th>
                  <th className="pb-2 font-medium">Grade</th>
                  <th className="pb-2 text-right font-medium">Pares</th>
                </tr>
              </thead>
              <tbody>
                {rel.modelagens.map((m) => (
                  <tr key={m.modelagem} className="border-b border-slate-800/50">
                    <td className="py-2 font-semibold">{m.modelagem}</td>
                    <td className="py-2">
                      <span className="flex flex-wrap gap-1">
                        {gradeEmLinhas(m.grade).map((l) => (
                          <span key={l.tamanho} className="rounded bg-slate-950 px-1.5 py-0.5 text-[11px]">
                            {l.tamanho} <span className="text-slate-400">{l.qtd}</span>
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="py-2 text-right font-semibold text-emerald-400">{m.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* lotes concluídos */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-3 text-sm font-semibold">Lotes concluídos ({rel.comResumo.length})</h3>
            <ul className="space-y-2">
              {rel.comResumo.map((l) => {
                const expandido = aberto === l.id
                return (
                  <li key={l.id} className="rounded-lg border border-slate-800">
                    <button
                      onClick={() => setAberto(expandido ? null : l.id)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left text-sm"
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                        <span className={`text-slate-500 transition-transform ${expandido ? 'rotate-90' : ''}`}>▶</span>
                        <span className="font-medium">{formatarDataHora(l.finalizado_em)}</span>
                        <span className="text-xs text-slate-500">
                          {(l.finalizado_por && nomes[l.finalizado_por]) || '—'}
                        </span>
                        <span className="text-xs text-slate-600">
                          {(l.resumo.pedidos ?? []).length} pedido(s)
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                        {l.resumo.totalPares || 0} pares
                      </span>
                    </button>

                    {expandido && (
                      <div className="border-t border-slate-800 px-3 py-2.5 text-sm">
                        <p className="text-xs text-slate-500">Pedidos</p>
                        <p className="mb-2">
                          {(l.resumo.pedidos ?? [])
                            .map((p) => `#${p.numero} ${p.cliente}`)
                            .join(' • ') || '—'}
                        </p>
                        {(l.resumo.modelagens ?? []).map((m) => (
                          <div key={m.modelagem} className="mt-1.5">
                            <span className="font-semibold">{m.modelagem}</span>{' '}
                            <span className="text-emerald-400">({m.total} pares)</span>
                            <span className="ml-2 inline-flex flex-wrap gap-1">
                              {gradeEmLinhas(m.grade).map((x) => (
                                <span key={x.tamanho} className="rounded bg-slate-950 px-1.5 py-0.5 text-[11px]">
                                  {x.tamanho} <span className="text-slate-400">{x.qtd}</span>
                                </span>
                              ))}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
