import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { usePedidos } from '../hooks/usePedidos'
import { urlsAnexos } from '../lib/anexos'
import { supabase } from '../lib/supabase'
import type { PlanoSemana, SemanaSetor } from '../types'
import { formatarData } from '../utils/tempo'

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
// cores atribuídas automaticamente aos setores novos
const CORES_SETOR = ['#ec1c24', '#f59e0b', '#818cf8', '#34d399', '#f472b6', '#a78bfa', '#fb923c', '#22c55e']

/** segunda-feira da semana atual + deslocamento em semanas */
function segundaDaSemana(offsetSemanas: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const dia = d.getDay()
  d.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1) + offsetSemanas * 7)
  return d
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Semana: planejamento do que deve ser feito, por setor e por dia.
 * Os setores são criados pelo próprio admin (só os que a produção usa).
 * Cada item é uma REFERÊNCIA ao pedido — ele continua na aba dele, e o
 * cartão mostra ao vivo em qual etapa está agora, com a foto do pedido.
 */
export default function Semana() {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const { pedidos } = usePedidos()
  const [params, setParams] = useSearchParams()
  const [offset, setOffset] = useState(0)
  const [itens, setItens] = useState<PlanoSemana[]>([])
  const [setores, setSetores] = useState<SemanaSetor[]>([])
  const [fotos, setFotos] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)
  // filtro de visualização: 'todos' | 'geral' | id do setor
  const [filtroSetor, setFiltroSetor] = useState('todos')
  // criação de setor por campo na tela (sem prompt do navegador)
  const [criandoSetor, setCriandoSetor] = useState(false)
  const [novoSetor, setNovoSetor] = useState('')
  // formulário (canto superior direito)
  const [setorSel, setSetorSel] = useState('')
  const [diaSel, setDiaSel] = useState(0) // 0 = segunda
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
  /** sábado e domingo: só usados para não esconder itens já planejados neles */
  const fimDeSemana = useMemo(
    () =>
      Array.from({ length: 2 }, (_, i) => {
        const d = new Date(segunda)
        d.setDate(d.getDate() + 5 + i)
        return d
      }),
    [segunda],
  )

  const pedidoPorId = useMemo(() => new Map(pedidos.map((p) => [p.id, p])), [pedidos])

  const carregar = async () => {
    const [pl, st] = await Promise.all([
      supabase
        .from('plano_semana')
        .select('*')
        .gte('dia', iso(diasSemana[0]))
        .lte('dia', iso(fimDeSemana[1]))
        .order('dia'),
      supabase.from('semana_setores').select('*').order('ordem').order('nome'),
    ])
    if (pl.error) toast(pl.error.message, 'erro')
    setItens((pl.data as PlanoSemana[]) ?? [])
    setSetores((st.data as SemanaSetor[]) ?? [])
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
    const ids = [...new Set(itens.map((i) => i.pedido_id).filter(Boolean))] as string[]
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
  }, [itens])

  // agrupa: setor → dia → itens ("Geral" quando sem setor), aplicando o filtro
  const grupos = useMemo(() => {
    const porSetor = new Map<string, PlanoSemana[]>()
    for (const it of itens) {
      const k = it.setor_id ?? 'geral'
      const lista = porSetor.get(k) ?? []
      lista.push(it)
      porSetor.set(k, lista)
    }
    const ordem = [...setores.map((s) => s.id), 'geral']
    return ordem
      .filter((k) => porSetor.has(k))
      .filter((k) => filtroSetor === 'todos' || k === filtroSetor)
      .map((k) => ({
        setor: k === 'geral' ? null : (setores.find((s) => s.id === k) ?? null),
        itens: porSetor.get(k)!,
      }))
  }, [itens, setores, filtroSetor])

  // ---------- ações ----------
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
    const { data, error } = await supabase
      .from('semana_setores')
      .insert({ nome, cor, ordem })
      .select()
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
      setFiltroSetor(criado.id)
    }
    setNovoSetor('')
    setCriandoSetor(false)
    toast(`Setor "${nome}" criado.`, 'sucesso')
  }

  const excluirSetor = async () => {
    const s = setores.find((x) => x.id === setorSel)
    if (!s) return
    if (!confirm(`Excluir o setor "${s.nome}"? As tarefas dele vão para "Geral".`)) return
    const { error } = await supabase.from('semana_setores').delete().eq('id', s.id)
    if (error) {
      const semPermissao = error.code === '42501' || /row-level security|permission/i.test(error.message)
      toast(
        semPermissao
          ? 'Sua conta não tem permissão de administrador NESTE projeto do banco.'
          : error.message,
        'erro',
      )
    } else {
      setSetorSel('')
      setFiltroSetor('todos')
      void carregar()
    }
  }

  const adicionar = async () => {
    const num = parseInt(numeroPedido, 10)
    let pedidoId: string | null = null
    if (num) {
      const p = pedidos.find((x) => x.numero === num)
      if (!p) {
        toast(`Pedido ${num} não encontrado.`, 'erro')
        return
      }
      pedidoId = p.id
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
      dia: iso(diasSemana[diaSel]),
      texto: texto.trim(),
      created_by: userData.user?.id,
    })
    setSalvando(false)
    if (error) toast(error.message, 'erro')
    else {
      toast('Adicionado ao plano da semana.', 'sucesso')
      setNumeroPedido('')
      setTexto('')
      if (params.get('pedido')) setParams({}, { replace: true })
      void carregar()
    }
  }

  const alternarFeito = async (it: PlanoSemana) => {
    setItens((arr) => arr.map((x) => (x.id === it.id ? { ...x, feito: !x.feito } : x)))
    // função própria no banco: funcionário só consegue mudar o "feito",
    // sem poder editar o resto da tarefa (edição é só admin)
    const { error } = await supabase.rpc('marcar_feito_semana', { p_id: it.id, p_feito: !it.feito })
    if (error) {
      toast(error.message, 'erro')
      void carregar()
    }
  }

  const excluir = async (it: PlanoSemana) => {
    if (!confirm('Remover este item do plano da semana?')) return
    const { error } = await supabase.from('plano_semana').delete().eq('id', it.id)
    if (error) toast(error.message, 'erro')
    else void carregar()
  }

  const rotuloDia = (d: Date) =>
    `${DIAS[(d.getDay() + 6) % 7]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  const hojeIso = iso(new Date())
  const setorEscolhido = setores.find((s) => s.id === setorSel) ?? null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold md:text-2xl">Semana</h1>
          <p className="text-sm text-slate-400">
            Seg {formatarData(iso(diasSemana[0]))} a Sex {formatarData(iso(diasSemana[4]))} •{' '}
            {itens.length} item(ns)
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => setOffset((o) => o - 1)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-800">
              ← Semana anterior
            </button>
            {offset !== 0 && (
              <button onClick={() => setOffset(0)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-slate-800">
                Hoje
              </button>
            )}
            <button onClick={() => setOffset((o) => o + 1)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-800">
              Próxima semana →
            </button>
          </div>
        </div>

        {/* Canto superior direito: escolher/criar o setor e adicionar ao plano */}
        {isAdmin && (
          <div
            className="w-full rounded-xl border bg-slate-900/80 p-3 shadow-lg sm:w-auto sm:min-w-[20rem]"
            style={{ borderColor: setorEscolhido ? `${setorEscolhido.cor}66` : '#2a3670' }}
          >
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Adicionar tarefa para o setor
            </label>
            <div className="flex gap-1.5">
              <select
                value={setorSel}
                onChange={(e) => {
                  setSetorSel(e.target.value)
                  // trocar o setor aqui também filtra o quadro para mostrar só ele
                  setFiltroSetor(e.target.value || 'geral')
                }}
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-medium outline-none focus:border-red-500"
              >
                <option value="">Geral (sem setor)</option>
                {setores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
              {/* o admin cria os próprios setores — só os que a produção usa */}
              <button
                onClick={() => setCriandoSetor((v) => !v)}
                title="Criar novo setor"
                className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
                  criandoSetor
                    ? 'border-emerald-600 text-emerald-400'
                    : 'border-slate-700 text-slate-300 hover:border-emerald-600 hover:text-emerald-400'
                }`}
              >
                +
              </button>
              {setorSel && (
                <button
                  onClick={() => void excluirSetor()}
                  title="Excluir o setor selecionado"
                  className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold text-slate-400 hover:border-rose-700 hover:text-rose-400"
                >
                  ✕
                </button>
              )}
            </div>

            {/* campo de criação do setor (aparece ao clicar no +) */}
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
                  className="min-w-0 flex-1 rounded-lg border border-emerald-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => void criarSetor()}
                  className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  Criar
                </button>
              </div>
            )}

            {/* dia da semana */}
            <div className="mt-2 flex gap-1">
              {diasSemana.map((d, i) => (
                <button
                  key={i}
                  onClick={() => setDiaSel(i)}
                  className={`flex-1 rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors ${
                    diaSel === i ? 'bg-red-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {DIAS[i]}
                </button>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-[7rem_1fr] gap-2">
              <input
                type="number"
                min={1}
                value={numeroPedido}
                onChange={(e) => setNumeroPedido(e.target.value)}
                placeholder="nº pedido"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500"
              />
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void adicionar()}
                placeholder="mensagem (ex.: prensar 20 camisas)"
                className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500"
              />
            </div>
            <button
              onClick={() => void adicionar()}
              disabled={salvando}
              className="mt-2 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            >
              {salvando ? 'Adicionando…' : '+ Adicionar à semana'}
            </button>
          </div>
        )}
      </div>

      {/* filtro por setor (todos os usuários): vê só o setor que interessa */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFiltroSetor('todos')}
          className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${
            filtroSetor === 'todos' ? 'bg-red-600 text-white' : 'border border-slate-700 text-slate-400 hover:bg-slate-800'
          }`}
        >
          Todos
        </button>
        {setores.map((s) => (
          <button
            key={s.id}
            onClick={() => setFiltroSetor(s.id)}
            className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${
              filtroSetor === s.id ? 'text-slate-950' : 'border border-slate-700 text-slate-400 hover:bg-slate-800'
            }`}
            style={filtroSetor === s.id ? { background: s.cor } : undefined}
          >
            {s.nome}
          </button>
        ))}
        <button
          onClick={() => setFiltroSetor('geral')}
          className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${
            filtroSetor === 'geral' ? 'bg-slate-600 text-white' : 'border border-slate-700 text-slate-400 hover:bg-slate-800'
          }`}
        >
          Geral
        </button>
      </div>

      {grupos.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-500">
          {filtroSetor === 'todos'
            ? `Nada planejado para esta semana${isAdmin ? ' — adicione acima.' : '.'}`
            : 'Nada planejado para este setor nesta semana.'}
        </p>
      ) : (
        grupos.map(({ setor, itens: doSetor }) => (
          <div key={setor?.id ?? 'geral'} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            {/* cabeçalho do setor */}
            <div
              className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5"
              style={{ borderTop: `3px solid ${setor?.cor ?? '#6b77ad'}`, marginTop: -1 }}
            >
              <span className="text-sm font-semibold" style={{ color: setor?.cor ?? '#9aa3cc' }}>
                {setor ? setor.nome : 'Geral'}
              </span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-400">
                {doSetor.filter((i) => i.feito).length}/{doSetor.length} feitos
              </span>
            </div>

            {/* dias: segunda a sexta sempre visíveis (separados);
                sábado/domingo só aparecem se tiverem algo planejado */}
            <div className="divide-y divide-slate-800">
              {[...diasSemana, ...fimDeSemana].map((d, idx) => {
                const doDia = doSetor.filter((i) => i.dia === iso(d))
                const ehFimDeSemana = idx >= 5
                if (ehFimDeSemana && doDia.length === 0) return null
                const hoje = iso(d) === hojeIso
                return (
                  <div key={iso(d)} className={`p-4 ${hoje ? 'bg-red-950/10' : ''}`}>
                    <p className={`mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${hoje ? 'text-red-400' : 'text-slate-500'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${hoje ? 'bg-red-500' : 'bg-slate-700'}`} />
                      {rotuloDia(d)}
                      {hoje && ' — hoje'}
                      <span className="ml-auto font-normal normal-case text-slate-600">
                        {doDia.length > 0 ? `${doDia.length} tarefa(s)` : ''}
                      </span>
                    </p>
                    {doDia.length === 0 ? (
                      <p className="text-xs text-slate-600">Sem tarefas neste dia.</p>
                    ) : (
                    <ul className="space-y-1.5">
                      {doDia.map((it) => {
                        const p = it.pedido_id ? pedidoPorId.get(it.pedido_id) : undefined
                        const foto = it.pedido_id ? fotos[it.pedido_id] : undefined
                        return (
                          <li key={it.id}
                            className={`flex flex-wrap items-center gap-2.5 rounded-lg border border-slate-800 px-3 py-2 text-sm ${it.feito ? 'opacity-50' : ''}`}>
                            {/* foto do pedido (primeira imagem anexada) */}
                            {p && foto && (
                              <Link to={`/pedidos/${p.numero}`} className="shrink-0">
                                <img
                                  src={foto}
                                  alt={`Foto do pedido ${p.numero}`}
                                  loading="lazy"
                                  className="h-12 w-12 rounded-md border border-slate-700 object-cover"
                                />
                              </Link>
                            )}
                            {p && (
                              <>
                                <Link to={`/pedidos/${p.numero}`}
                                  className={`font-bold text-red-400 hover:underline ${it.feito ? 'line-through' : ''}`}>
                                  #{p.numero}
                                </Link>
                                <span className="max-w-[10rem] truncate text-slate-300">{p.cliente}</span>
                                <span className="text-xs text-slate-600">{p.quantidade} un.</span>
                                {/* onde o pedido está AGORA (ao vivo) */}
                                {p.status === 'concluido' ? (
                                  <span className="rounded-full bg-emerald-900 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                                    ✓ Concluído
                                  </span>
                                ) : p.etapa_atual ? (
                                  <span className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                                    style={{ background: `${p.etapa_atual.cor}22`, color: p.etapa_atual.cor }}>
                                    agora em: {p.etapa_atual.nome}
                                  </span>
                                ) : null}
                              </>
                            )}
                            {it.texto && (
                              <span className={`min-w-0 flex-1 text-slate-400 ${it.feito ? 'line-through' : ''}`}>
                                {it.texto}
                              </span>
                            )}
                            {/* marcar como feito: botão explícito (qualquer funcionário) */}
                            <button
                              onClick={() => void alternarFeito(it)}
                              className={`ml-auto shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                                it.feito
                                  ? 'border-emerald-700 bg-emerald-900 text-emerald-300'
                                  : 'border-slate-600 text-slate-300 hover:border-emerald-600 hover:text-emerald-400'
                              }`}
                            >
                              {it.feito ? '✓ Feito' : 'Marcar feito'}
                            </button>
                            {isAdmin && (
                              <button onClick={() => void excluir(it)}
                                className="shrink-0 text-xs text-slate-500 hover:text-rose-400" title="Remover do plano">
                                ✕
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
