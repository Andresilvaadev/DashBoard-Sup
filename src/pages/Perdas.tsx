import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import StatCard from '../components/StatCard'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { supabase } from '../lib/supabase'
import type { Perda } from '../types'
import { formatarDataHora } from '../utils/tempo'

const MATERIAIS = ['Tecido', 'Papel', 'Tinta','Caneca', 'Outros']
const UNIDADES = ['un', 'metros', 'folhas', 'litros', 'kg']

type Filtro = 'semana' | 'mes' | 'ano' | 'personalizado'
const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mês' },
  { id: 'ano', label: 'Este ano' },
  { id: 'personalizado', label: 'Período' },
]

const fmtReal = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function inicioDoFiltro(f: Filtro): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (f === 'semana') {
    const dia = d.getDay()
    d.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1))
  } else if (f === 'mes') d.setDate(1)
  else if (f === 'ano') d.setMonth(0, 1)
  return d
}

/** Perdas de material: registro, relatórios por material/período e ranking por funcionário. */
export default function Perdas() {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const [perdas, setPerdas] = useState<Perda[]>([])
  const [movs, setMovs] = useState<{ pedido_id: string; funcionario_id: string | null }[]>([])
  const [totalPedidosPeriodo, setTotalPedidosPeriodo] = useState(0)
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [filtro, setFiltro] = useState<Filtro>('mes')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [formAberto, setFormAberto] = useState(false)
  const [salvando, setSalvando] = useState(false)
  // campos do formulário
  const [numeroPedido, setNumeroPedido] = useState('')
  const [material, setMaterial] = useState(MATERIAIS[0])
  const [quantidade, setQuantidade] = useState('')
  const [unidade, setUnidade] = useState(UNIDADES[0])
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [observacoes, setObservacoes] = useState('')

  // período efetivo (personalizado usa os inputs de data)
  const inicioISO =
    filtro === 'personalizado' && de ? new Date(de + 'T00:00:00').toISOString() : inicioDoFiltro(filtro).toISOString()
  const fimISO =
    filtro === 'personalizado' && ate ? new Date(ate + 'T23:59:59').toISOString() : new Date().toISOString()

  const carregar = async () => {
    const [pr, hi, pe, fu] = await Promise.all([
      supabase
        .from('perdas')
        .select('*, funcionario:profiles(id, nome), pedido:pedidos(id, numero, cliente)')
        .gte('created_at', inicioISO)
        .lte('created_at', fimISO)
        .order('created_at', { ascending: false }),
      supabase
        .from('historico')
        .select('pedido_id, funcionario_id')
        .gte('entrada', inicioISO)
        .lte('entrada', fimISO),
      supabase
        .from('pedidos')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', inicioISO)
        .lte('created_at', fimISO),
      supabase.from('profiles').select('id, nome'),
    ])
    setPerdas((pr.data as Perda[]) ?? [])
    setMovs((hi.data as { pedido_id: string; funcionario_id: string | null }[]) ?? [])
    setTotalPedidosPeriodo(pe.count ?? 0)
    const mapa: Record<string, string> = {}
    for (const f of (fu.data as { id: string; nome: string }[]) ?? []) mapa[f.id] = f.nome
    setNomes(mapa)
  }

  useEffect(() => {
    carregar()
    const canal = supabase
      .channel(`perdas-rt-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'perdas' }, carregar)
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicioISO, fimISO])

  const rel = useMemo(() => {
    const valorTotal = perdas.reduce((a, p) => a + (p.valor || 0), 0)
    const qtdTotal = perdas.reduce((a, p) => a + (p.quantidade || 0), 0)

    // por material (quantidade, valor, registros)
    const porMaterial = MATERIAIS.map((m) => {
      const doM = perdas.filter((p) => p.material === m)
      return {
        material: m,
        registros: doM.length,
        quantidade: doM.reduce((a, p) => a + (p.quantidade || 0), 0),
        valor: doM.reduce((a, p) => a + (p.valor || 0), 0),
      }
    }).filter((m) => m.registros > 0)

    // por mês (dentro do período)
    const porMesMap = new Map<string, { valor: number; registros: number }>()
    for (const p of perdas) {
      const k = p.created_at.slice(0, 7)
      const atual = porMesMap.get(k) ?? { valor: 0, registros: 0 }
      atual.valor += p.valor || 0
      atual.registros += 1
      porMesMap.set(k, atual)
    }
    const porMes = [...porMesMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({
        rotulo: new Date(k + '-02').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        ...v,
      }))

    // índice geral: perdas registradas ÷ pedidos criados no período
    const indice = totalPedidosPeriodo > 0 ? (perdas.length / totalPedidosPeriodo) * 100 : null

    // ranking por funcionário: pedidos trabalhados (únicos no histórico) x perdas
    const trabalhados = new Map<string, Set<string>>()
    for (const m of movs) {
      if (!m.funcionario_id) continue
      const s = trabalhados.get(m.funcionario_id) ?? new Set<string>()
      s.add(m.pedido_id)
      trabalhados.set(m.funcionario_id, s)
    }
    const perdasPorFunc = new Map<string, { registros: number; valor: number }>()
    for (const p of perdas) {
      if (!p.funcionario_id) continue
      const atual = perdasPorFunc.get(p.funcionario_id) ?? { registros: 0, valor: 0 }
      atual.registros += 1
      atual.valor += p.valor || 0
      perdasPorFunc.set(p.funcionario_id, atual)
    }
    const idsFunc = new Set([...trabalhados.keys(), ...perdasPorFunc.keys()])
    const ranking = [...idsFunc]
      .map((id) => {
        const produzidos = trabalhados.get(id)?.size ?? 0
        const pd = perdasPorFunc.get(id) ?? { registros: 0, valor: 0 }
        return {
          id,
          nome: nomes[id] ?? '—',
          produzidos,
          perdas: pd.registros,
          valor: pd.valor,
          indice: produzidos > 0 ? (pd.registros / produzidos) * 100 : pd.registros > 0 ? 100 : 0,
        }
      })
      .sort((a, b) => b.indice - a.indice || b.valor - a.valor)

    return { valorTotal, qtdTotal, porMaterial, porMes, indice, ranking }
  }, [perdas, movs, nomes, totalPedidosPeriodo])

  const registrar = async (e: FormEvent) => {
    e.preventDefault()
    setSalvando(true)
    let pedidoId: string | null = null
    const num = parseInt(numeroPedido, 10)
    if (num) {
      const { data } = await supabase.from('pedidos').select('id').eq('numero', num).maybeSingle()
      pedidoId = (data?.id as string | undefined) ?? null
      if (!pedidoId) {
        setSalvando(false)
        toast(`Pedido ${num} não encontrado.`, 'erro')
        return
      }
    }
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('perdas').insert({
      pedido_id: pedidoId,
      funcionario_id: userData.user?.id,
      material,
      quantidade: Number(quantidade.replace(',', '.')) || 0,
      unidade,
      valor: Number(valor.replace(',', '.')) || 0,
      motivo,
      observacoes,
    })
    setSalvando(false)
    if (error) toast(error.message, 'erro')
    else {
      toast('Perda registrada.', 'sucesso')
      setFormAberto(false)
      setNumeroPedido('')
      setQuantidade('')
      setValor('')
      setMotivo('')
      setObservacoes('')
      carregar()
    }
  }

  const excluir = async (p: Perda) => {
    if (!confirm(`Excluir este registro de perda (${p.material})?`)) return
    const { error } = await supabase.from('perdas').delete().eq('id', p.id)
    if (error) toast(error.message, 'erro')
    else carregar()
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold md:text-2xl">Perdas de material</h1>
          <p className="text-sm text-slate-400">{perdas.length} registro(s) no período</p>
        </div>
        <button
          onClick={() => setFormAberto(true)}
          className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500"
        >
          + Registrar perda
        </button>
      </div>

      {/* Filtro de período */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${
              filtro === f.id ? 'bg-red-600 text-white' : 'border border-slate-700 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {f.label}
          </button>
        ))}
        {filtro === 'personalizado' && (
          <span className="flex items-center gap-2 text-xs text-slate-400">
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs outline-none focus:border-red-500" />
            até
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs outline-none focus:border-red-500" />
          </span>
        )}
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard titulo="Registros de perda" valor={perdas.length} cor="text-rose-400" />
        <StatCard titulo="Quantidade perdida" valor={rel.qtdTotal.toLocaleString('pt-BR')} detalhe="soma das quantidades" cor="text-amber-400" />
        <StatCard titulo="Valor perdido" valor={fmtReal(rel.valorTotal)} cor="text-rose-400" />
        <StatCard
          titulo="Índice de perdas"
          valor={rel.indice != null ? `${rel.indice.toFixed(1)}%` : '—'}
          detalhe={`sobre ${totalPedidosPeriodo} pedido(s) do período`}
          cor="text-violet-400"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Perdas por material */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">Perdas por material</h2>
          {rel.porMaterial.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Nenhuma perda no período.</p>
          ) : (
            <>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rel.porMaterial} margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2455" />
                    <XAxis dataKey="material" tick={{ fill: '#9aa3cc', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#9aa3cc', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: '#0b1233', border: '1px solid #2a3670', borderRadius: 8 }}
                      labelStyle={{ color: '#dfe3f2' }}
                      cursor={{ fill: '#1a2455' }}
                      formatter={(v: number) => [fmtReal(v), 'Valor perdido']}
                    />
                    <Bar dataKey="valor" name="Valor" radius={[4, 4, 0, 0]}>
                      {rel.porMaterial.map((_, i) => (
                        <Cell key={i} fill={['#ec1c24', '#f59e0b', '#a78bfa', '#34d399', '#818cf8', '#f472b6', '#94a3b8'][i % 7]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                    <th className="pb-2 font-medium">Material</th>
                    <th className="pb-2 text-right font-medium">Registros</th>
                    <th className="pb-2 text-right font-medium">Qtd</th>
                    <th className="pb-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {rel.porMaterial.map((m) => (
                    <tr key={m.material} className="border-b border-slate-800/50">
                      <td className="py-2">{m.material}</td>
                      <td className="py-2 text-right">{m.registros}</td>
                      <td className="py-2 text-right">{m.quantidade.toLocaleString('pt-BR')}</td>
                      <td className="py-2 text-right text-rose-300">{fmtReal(m.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {/* Perdas por mês */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">Perdas por mês (valor)</h2>
          {rel.porMes.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Nenhuma perda no período.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rel.porMes} margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a2455" />
                  <XAxis dataKey="rotulo" tick={{ fill: '#9aa3cc', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#9aa3cc', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#0b1233', border: '1px solid #2a3670', borderRadius: 8 }}
                    labelStyle={{ color: '#dfe3f2' }}
                    cursor={{ fill: '#1a2455' }}
                    formatter={(v: number, nome: string) => (nome === 'Valor' ? [fmtReal(v), nome] : [v, nome])}
                  />
                  <Bar dataKey="valor" name="Valor" fill="#ec1c24" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Ranking por funcionário */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold">Ranking de perdas por funcionário</h2>
        {rel.ranking.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Sem dados no período.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                    <th className="pb-2 font-medium">Funcionário</th>
                    <th className="pb-2 text-right font-medium">Pedidos</th>
                    <th className="pb-2 text-right font-medium">Perdas</th>
                    <th className="pb-2 text-right font-medium">Valor</th>
                    <th className="pb-2 text-right font-medium">Índice</th>
                  </tr>
                </thead>
                <tbody>
                  {rel.ranking.map((r) => (
                    <tr key={r.id} className="border-b border-slate-800/50">
                      <td className="py-2 font-medium">{r.nome}</td>
                      <td className="py-2 text-right">{r.produzidos}</td>
                      <td className="py-2 text-right">{r.perdas}</td>
                      <td className="py-2 text-right text-rose-300">{fmtReal(r.valor)}</td>
                      <td className={`py-2 text-right font-semibold ${r.indice > 20 ? 'text-rose-400' : r.indice > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {r.indice.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rel.ranking.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a2455" />
                  <XAxis type="number" tick={{ fill: '#9aa3cc', fontSize: 11 }} />
                  <YAxis type="category" dataKey="nome" width={90} tick={{ fill: '#9aa3cc', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: '#0b1233', border: '1px solid #2a3670', borderRadius: 8 }}
                    labelStyle={{ color: '#dfe3f2' }}
                    cursor={{ fill: '#1a2455' }}
                    formatter={(v: number) => [`${Number(v).toFixed(1)}%`, 'Índice de perdas']}
                  />
                  <Bar dataKey="indice" name="Índice" fill="#f43f5e" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Lista de registros */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold">Registros do período</h2>
        {perdas.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Nenhuma perda registrada.</p>
        ) : (
          <ul className="space-y-2">
            {perdas.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2.5 text-sm">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">{p.material}</span>
                  <span className="text-slate-400">{p.quantidade} {p.unidade}</span>
                  {p.valor > 0 && <span className="text-rose-300">{fmtReal(p.valor)}</span>}
                  {p.pedido && <span className="text-red-400">#{p.pedido.numero}</span>}
                  {p.motivo && <span className="truncate text-xs text-slate-500">— {p.motivo}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                  {p.funcionario?.nome ?? '—'} · {formatarDataHora(p.created_at)}
                  {isAdmin && (
                    <button onClick={() => void excluir(p)} className="text-slate-500 hover:text-rose-400">
                      ✕
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modal de registro */}
      {formAberto && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 md:items-center" onClick={() => setFormAberto(false)}>
          <form onSubmit={registrar} onClick={(e) => e.stopPropagation()}
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <h2 className="text-lg font-bold">Registrar perda</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-400">Material *</label>
                <select value={material} onChange={(e) => setMaterial(e.target.value)} className={inputCls}>
                  {MATERIAIS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400">Pedido (nº, opcional)</label>
                <input type="number" min={1} value={numeroPedido} onChange={(e) => setNumeroPedido(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400">Quantidade *</label>
                <input required value={quantidade} onChange={(e) => setQuantidade(e.target.value)} placeholder="ex.: 2,5" className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400">Unidade</label>
                <select value={unidade} onChange={(e) => setUnidade(e.target.value)} className={inputCls}>
                  {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-400">Valor perdido (R$, opcional)</label>
                <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="ex.: 35,90" className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-400">Motivo *</label>
                <input required value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: erro de corte, mancha na prensagem" className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-400">Observações</label>
                <textarea rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setFormAberto(false)}
                className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm font-medium hover:bg-slate-800">
                Cancelar
              </button>
              <button type="submit" disabled={salvando}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">
                {salvando ? 'Salvando…' : 'Registrar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
