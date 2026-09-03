import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import RelatorioCortes from '../components/RelatorioCortes'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { useEtapas } from '../hooks/useEtapas'
import { usePedidos } from '../hooks/usePedidos'
import { urlsAnexos } from '../lib/anexos'
import { supabase } from '../lib/supabase'
import type { Anexo, FichaTecnica, LoteCorte, PartesCorte } from '../types'
import {
  agruparParaCorte,
  especificacoesDoGrupo,
  gradeEmLinhas,
  observacoesDoGrupo,
  partesDoTamanho,
  tamanhoCortado,
  type GrupoCorte,
} from '../utils/corte'
import { formatarData, formatarDataHora } from '../utils/tempo'

/**
 * Mapa de Corte: monta um LOTE com vários pedidos, agrupa as fichas por
 * modelagem e soma as grades. O lote fica SALVO (não some ao sair da tela),
 * o operador marca cada tamanho já cortado e, ao concluir, todos os pedidos
 * avançam automaticamente para a próxima etapa.
 * Cada unidade = 1 par (frente + costa).
 */
export default function MapaCorte() {
  const { profile } = useAuth()
  const toast = useToast()
  const confirmar = useConfirm()
  const { pedidos } = usePedidos()
  const { etapas } = useEtapas()
  const [lote, setLote] = useState<LoteCorte | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [busca, setBusca] = useState('')
  const [grupos, setGrupos] = useState<GrupoCorte[] | null>(null)
  const [urlsLayout, setUrlsLayout] = useState<Record<string, string>>({})
  const [gerando, setGerando] = useState(false)
  const [baixando, setBaixando] = useState(false)
  const [concluindo, setConcluindo] = useState(false)
  const [fichaAberta, setFichaAberta] = useState<FichaTecnica | null>(null)
  const [comFicha, setComFicha] = useState<Set<string>>(new Set())
  // aba: montar o corte do dia x histórico do que já foi cortado
  const [aba, setAba] = useState<'mapa' | 'relatorio'>('mapa')

  /** etapas de corte (qualquer fluxo) — só elas entram no mapa */
  const idsEtapaCorte = useMemo(() => {
    const semAcento = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    return new Set(etapas.filter((e) => e.ativo && semAcento(e.nome).includes('corte')).map((e) => e.id))
  }, [etapas])

  const disponiveis = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return pedidos
      // apenas pedidos que estão AGORA na etapa de corte
      .filter((p) => p.status === 'em_andamento' && idsEtapaCorte.has(p.etapa_atual_id ?? ''))
      .filter((p) => !q || String(p.numero).includes(q) || p.cliente.toLowerCase().includes(q))
      .slice(0, 200)
  }, [pedidos, busca, idsEtapaCorte])

  /** monta os grupos (fichas somadas) a partir dos ids de pedidos do lote */
  const montarGrupos = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        setGrupos([])
        return
      }
      const { data, error } = await supabase
        .from('fichas_tecnicas')
        .select('*, pedido:pedidos(id, numero, cliente, created_at)')
        .in('pedido_id', ids)
      if (error) {
        toast(error.message, 'erro')
        return
      }
      const fichas = (data as unknown as FichaTecnica[]) ?? []
      const gs = agruparParaCorte(fichas)
      setGrupos(gs)

      const idsLayout = gs.map((g) => g.layoutAnexoId).filter(Boolean) as string[]
      if (idsLayout.length > 0) {
        const { data: anexos } = await supabase.from('anexos').select('id, path').in('id', idsLayout)
        const lista = (anexos ?? []) as Pick<Anexo, 'id' | 'path'>[]
        const urls = await urlsAnexos(lista.map((a) => a.path), { miniatura: true })
        const mapa: Record<string, string> = {}
        for (const a of lista) if (urls[a.path]) mapa[a.id] = urls[a.path]
        setUrlsLayout(mapa)
      } else {
        setUrlsLayout({})
      }
    },
    [toast],
  )

  // ao abrir a tela: retoma o lote em aberto (o mapa não some mais)
  useEffect(() => {
    const carregar = async () => {
      const [lt, ft] = await Promise.all([
        supabase
          .from('lotes_corte')
          .select('*')
          .is('finalizado_em', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('fichas_tecnicas').select('pedido_id'),
      ])
      setComFicha(new Set(((ft.data ?? []) as { pedido_id: string }[]).map((f) => f.pedido_id)))
      const aberto = lt.data as LoteCorte | null
      if (aberto) {
        setLote(aberto)
        setSelecionados(new Set(aberto.pedido_ids))
        await montarGrupos(aberto.pedido_ids)
      }
    }
    void carregar()
  }, [montarGrupos])

  const alternar = (id: string) =>
    setSelecionados((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  /** cria o lote no banco (fica salvo) e monta o mapa */
  const gerar = async () => {
    if (selecionados.size === 0) {
      toast('Selecione ao menos um pedido.', 'erro')
      return
    }
    setGerando(true)
    try {
      const ids = [...selecionados]
      const { data: userData } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('lotes_corte')
        .insert({ pedido_ids: ids, progresso: {}, created_by: userData.user?.id })
        .select()
        .single()
      if (error) throw new Error(error.message)
      setLote(data as LoteCorte)
      await montarGrupos(ids)
      toast('Lote de corte criado. Ele fica salvo até você concluir.', 'sucesso')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha ao gerar o mapa.', 'erro')
    } finally {
      setGerando(false)
    }
  }

  /**
   * Marca/desmarca UMA parte do tamanho (camisa ou manga). O tamanho só
   * conta como cortado quando as duas estiverem marcadas — o corpo e as
   * mangas saem em momentos diferentes do corte.
   */
  const alternarParte = async (modelagem: string, tamanho: string, parte: keyof PartesCorte) => {
    if (!lote) return
    const atual = partesDoTamanho(lote.progresso?.[modelagem]?.[tamanho])
    const novo: PartesCorte = { ...atual, [parte]: !atual[parte] }
    const progresso = {
      ...lote.progresso,
      [modelagem]: { ...(lote.progresso?.[modelagem] ?? {}), [tamanho]: novo },
    }
    setLote({ ...lote, progresso }) // otimista
    const { error } = await supabase.from('lotes_corte').update({ progresso }).eq('id', lote.id)
    if (error) toast(error.message, 'erro')
  }

  /** conclui o corte: marca o lote e avança TODOS os pedidos para a próxima etapa */
  const concluirCorte = async () => {
    if (!lote) return
    const numeros = pedidos.filter((p) => lote.pedido_ids.includes(p.id))
    if (
      !(await confirmar({
        titulo: 'Concluir corte',
        mensagem: `${numeros.length} pedido(s) serão avançados automaticamente para a próxima etapa do fluxo de cada um.`,
        textoConfirmar: 'Concluir',
      }))
    )
      return
    setConcluindo(true)
    let movidos = 0
    let semProxima = 0
    try {
      for (const p of numeros) {
        const atual = etapas.find((e) => e.id === p.etapa_atual_id)
        if (!atual) continue
        // próxima etapa ativa do MESMO fluxo, pela ordem
        const proxima = etapas
          .filter((e) => e.ativo && (e.fluxo ?? 'producao') === (atual.fluxo ?? 'producao') && e.ordem > atual.ordem)
          .sort((a, b) => a.ordem - b.ordem)[0]
        if (!proxima) {
          semProxima++
          continue
        }
        const { error } = await supabase.rpc('mover_pedido', {
          p_numero: p.numero,
          p_etapa_id: proxima.id,
          p_observacao: 'Corte concluído (Mapa de Corte)',
          p_via_voz: false,
        })
        if (!error) movidos++
      }
      // guarda o RETRATO do que foi cortado (o histórico não muda se a
      // ficha técnica for editada depois)
      const { data: userData } = await supabase.auth.getUser()
      const resumo = {
        pedidos: numeros.map((p) => ({ numero: p.numero, cliente: p.cliente })),
        modelagens: (grupos ?? []).map((g) => ({
          modelagem: g.modelagem,
          grade: g.grade,
          total: g.total,
        })),
        totalPares: (grupos ?? []).reduce((a, g) => a + g.total, 0),
      }
      await supabase
        .from('lotes_corte')
        .update({
          finalizado_em: new Date().toISOString(),
          finalizado_por: userData.user?.id,
          resumo,
        })
        .eq('id', lote.id)
      setLote(null)
      setGrupos(null)
      setSelecionados(new Set())
      toast(
        `Corte concluído. ${movidos} pedido(s) avançaram de etapa` +
          (semProxima > 0 ? ` • ${semProxima} já estavam na última etapa.` : '.'),
        'sucesso',
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha ao concluir o corte.', 'erro')
    } finally {
      setConcluindo(false)
    }
  }

  const descartarLote = async () => {
    if (!lote) return
    if (
      !(await confirmar({
        titulo: 'Descartar lote',
        mensagem: 'Descartar este lote de corte? Os pedidos não são alterados.',
        textoConfirmar: 'Descartar',
        perigo: true,
      }))
    )
      return
    await supabase.from('lotes_corte').update({ finalizado_em: new Date().toISOString() }).eq('id', lote.id)
    setLote(null)
    setGrupos(null)
    setSelecionados(new Set())
  }

  const imprimir = async () => {
    if (!grupos || grupos.length === 0) return
    setBaixando(true)
    try {
      const { gerarPdfMapaCorte } = await import('../utils/mapaCortePdf')
      const numeros = pedidos
        .filter((p) => selecionados.has(p.id))
        .map((p) => `#${p.numero}`)
        .join(', ')
      await gerarPdfMapaCorte({
        lote: lote ? formatarData(lote.created_at).replace(/\//g, '') : new Date().toLocaleDateString('pt-BR').replace(/\//g, ''),
        responsavel: profile?.nome ?? '',
        pedidos: numeros,
        grupos,
        urlsLayout,
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha ao gerar o PDF.', 'erro')
    } finally {
      setBaixando(false)
    }
  }

  const totalGeral = grupos?.reduce((a, g) => a + g.total, 0) ?? 0
  // progresso global do lote (tamanhos marcados / total de tamanhos)
  const progresso = useMemo(() => {
    if (!grupos || !lote) return { feitos: 0, total: 0 }
    let feitos = 0
    let total = 0
    for (const g of grupos) {
      const chave = g.chave
      for (const l of gradeEmLinhas(g.grade)) {
        total++
        if (tamanhoCortado(lote.progresso?.[chave]?.[l.tamanho])) feitos++
      }
    }
    return { feitos, total }
  }, [grupos, lote])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold md:text-2xl">Mapa de Corte</h1>
          <p className="text-sm text-slate-400">
            {lote
              ? `Lote aberto desde ${formatarDataHora(lote.created_at)} • ${lote.pedido_ids.length} pedido(s)`
              : 'Pedidos que estão na etapa de corte — o sistema soma as grades por modelagem'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* alterna entre montar o corte e ver o histórico */}
          <div className="flex rounded-lg border border-slate-700 p-0.5">
            {(
              [
                ['mapa', 'Mapa'],
                ['relatorio', 'Cortados'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setAba(id)}
                className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                  aba === id ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {aba === 'mapa' && !lote && (
            <button
              onClick={() => void gerar()}
              disabled={gerando || selecionados.size === 0}
              className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            >
              {gerando ? 'Gerando…' : `Gerar Mapa de Corte (${selecionados.size})`}
            </button>
          )}
          {aba === 'mapa' && grupos && grupos.length > 0 && (
            <button
              onClick={() => void imprimir()}
              disabled={baixando}
              className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {baixando ? 'Gerando PDF…' : '↓ Imprimir Mapa'}
            </button>
          )}
          {aba === 'mapa' && lote && (
            <>
              <button
                onClick={() => void concluirCorte()}
                disabled={concluindo}
                className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {concluindo ? 'Concluindo…' : '✓ Terminei o corte'}
              </button>
              <button
                onClick={() => void descartarLote()}
                className="rounded-lg border border-slate-700 px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-slate-800"
                title="Descartar o lote sem mover os pedidos"
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      {/* histórico do que já foi cortado */}
      {aba === 'relatorio' && <RelatorioCortes />}

      {/* barra de progresso do corte */}
      {aba === 'mapa' && lote && progresso.total > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Progresso do corte</span>
            <span className={progresso.feitos === progresso.total ? 'font-bold text-emerald-400' : 'text-slate-400'}>
              {progresso.feitos}/{progresso.total} tamanhos cortados
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progresso.total ? (progresso.feitos / progresso.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* seleção de pedidos (só quando não há lote aberto) */}
      {aba === 'mapa' && !lote && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Pedidos na etapa de corte
              <span className="ml-2 text-xs font-normal text-slate-500">({disponiveis.length})</span>
            </h2>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por número ou cliente…"
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-red-500"
            />
          </div>
          {disponiveis.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              {idsEtapaCorte.size === 0
                ? 'Nenhuma etapa chamada "Corte" no fluxo de produção — crie ou renomeie uma em Admin → Fluxo.'
                : busca
                  ? 'Nenhum pedido encontrado na busca.'
                  : 'Nenhum pedido na etapa de corte no momento.'}
            </p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {disponiveis.map((p) => {
                const marcado = selecionados.has(p.id)
                const temFicha = comFicha.has(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => alternar(p.id)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      marcado ? 'border-red-500 bg-red-950/30' : 'border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                        marcado ? 'border-red-500 bg-red-600 text-white' : 'border-slate-600'
                      }`}
                    >
                      {marcado && '✓'}
                    </span>
                    <span className="font-bold text-red-400">#{p.numero}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-300">{p.cliente}</span>
                    {!temFicha && (
                      <span className="shrink-0 text-[10px] text-amber-500" title="Pedido sem ficha técnica">
                        sem ficha
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* pedidos do lote aberto */}
      {aba === 'mapa' && lote && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 text-sm font-semibold">Pedidos deste lote</h2>
          <div className="flex flex-wrap gap-1.5">
            {pedidos
              .filter((p) => lote.pedido_ids.includes(p.id))
              .map((p) => (
                <Link
                  key={p.id}
                  to={`/pedidos/${p.numero}`}
                  className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-red-500 hover:text-red-400"
                >
                  #{p.numero} · {p.cliente}
                </Link>
              ))}
          </div>
        </div>
      )}

      {/* resultado do mapa */}
      {aba === 'mapa' &&
        grupos &&
        (grupos.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Os pedidos selecionados não têm fichas técnicas cadastradas.
          </p>
        ) : (
          <>
            <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
              <p className="text-sm">
                <span className="font-semibold">{grupos.length} modelagem(ns)</span>
                <span className="mx-2 text-slate-600">•</span>
                <span className="font-semibold text-emerald-400">{totalGeral} pares</span>
                <span className="ml-2 text-xs text-slate-500">no total (frente + costa já inclusos)</span>
              </p>
            </div>

            {grupos.map((g) => {
              const chave = g.chave
              const linhas = gradeEmLinhas(g.grade)
              const feitosDoGrupo = linhas.filter((l) =>
                tamanhoCortado(lote?.progresso?.[chave]?.[l.tamanho]),
              ).length
              return (
                <div key={g.modelagem} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                    <h2 className="text-base font-bold uppercase tracking-wide">{g.modelagem}</h2>
                    <span className="flex items-center gap-2">
                      {lote && (
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            feitosDoGrupo === linhas.length
                              ? 'bg-emerald-900 text-emerald-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {feitosDoGrupo}/{linhas.length} cortados
                        </span>
                      )}
                      {g.totalMangaLonga > 0 && (
                        <span
                          title="Do total, quantas peças levam manga longa"
                          className="rounded-full bg-amber-900 px-3 py-1 text-sm font-semibold text-amber-300"
                        >
                          {g.totalMangaLonga} manga longa
                        </span>
                      )}
                      <span className="rounded-full bg-slate-800 px-3 py-1 text-sm font-semibold text-emerald-400">
                        Total: {g.total} pares
                      </span>
                    </span>
                  </div>

                  {/* Especificações do corte: o que a cortadeira precisa saber
                      antes de encostar na tesoura */}
                  {(() => {
                    const especs = especificacoesDoGrupo(g)
                    const obs = observacoesDoGrupo(g)
                    if (especs.length === 0 && obs.length === 0) return null
                    return (
                      <div className="border-b border-slate-800 bg-slate-950/40 px-4 py-3">
                        <div className="flex flex-wrap gap-x-5 gap-y-2">
                          {especs.map((e) => (
                            <div key={e.rotulo} className="min-w-0">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                {e.rotulo}
                                {e.divergente && (
                                  <span
                                    title="As fichas deste grupo têm valores diferentes — confira antes de cortar junto"
                                    className="ml-1.5 rounded-full bg-amber-900 px-1.5 py-0.5 text-[9px] font-bold text-amber-300"
                                  >
                                    diferente
                                  </span>
                                )}
                              </p>
                              <p
                                className={`text-sm font-semibold ${
                                  e.divergente ? 'text-amber-300' : 'text-slate-200'
                                }`}
                              >
                                {e.valores.map((v, i) => (
                                  <span key={v.valor}>
                                    {i > 0 && <span className="text-slate-600"> · </span>}
                                    {v.valor}
                                    {e.divergente && v.pedidos.length > 0 && (
                                      <span className="ml-1 text-xs font-normal text-slate-500">
                                        (#{v.pedidos.join(', #')})
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </p>
                            </div>
                          ))}
                        </div>

                        {obs.map((o) => (
                          <p key={o.texto} className="mt-2 text-xs text-amber-200/90">
                            <span className="font-semibold">Obs.</span>{' '}
                            {o.pedidos.length > 0 && (
                              <span className="text-slate-500">#{o.pedidos.join(', #')} — </span>
                            )}
                            {o.texto}
                          </p>
                        ))}
                      </div>
                    )
                  })()}

                  <div className="grid gap-4 p-4 md:grid-cols-2">
                    <div>
                      <table className="w-full max-w-sm text-sm">
                        <thead>
                          <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                            <th className="pb-2 font-medium">Tamanho</th>
                            <th className="pb-2 text-right font-medium">Pares</th>
                            {/* só aparece quando há manga longa no grupo: o corpo
                                é o mesmo, o que muda é quantas mangas compridas
                                sair */}
                            {g.totalMangaLonga > 0 && (
                              <th className="pb-2 text-right font-medium">Manga longa</th>
                            )}
                            {lote && <th className="pb-2 text-right font-medium">Camisas / Mangas</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {linhas.map((l) => {
                            const partes = partesDoTamanho(lote?.progresso?.[chave]?.[l.tamanho])
                            const cortado = partes.camisa && partes.manga
                            return (
                              <tr
                                key={l.tamanho}
                                className={`border-b border-slate-800/50 ${cortado ? 'opacity-60' : ''}`}
                              >
                                <td className={`py-1.5 font-semibold ${cortado ? 'line-through' : ''}`}>
                                  {l.tamanho}
                                </td>
                                <td className="py-1.5 text-right text-slate-300">{l.qtd}</td>
                                {g.totalMangaLonga > 0 && (
                                  <td className="py-1.5 text-right">
                                    {g.mangaLonga[l.tamanho] ? (
                                      <span className="font-semibold text-amber-400">
                                        {g.mangaLonga[l.tamanho]}
                                      </span>
                                    ) : (
                                      <span className="text-slate-700">—</span>
                                    )}
                                  </td>
                                )}
                                {lote && (
                                  <td className="py-1.5">
                                    {/* o tamanho só fica pronto com as duas partes cortadas */}
                                    <div className="flex justify-end gap-1.5">
                                      {(
                                        [
                                          ['camisa', 'Camisas'],
                                          ['manga', 'Mangas'],
                                        ] as const
                                      ).map(([campo, rotulo]) => (
                                        <button
                                          key={campo}
                                          onClick={() => void alternarParte(chave, l.tamanho, campo)}
                                          title={`${rotulo} do tamanho ${l.tamanho}`}
                                          className={`rounded-md border px-2 py-1 text-xs font-semibold transition-colors ${
                                            partes[campo]
                                              ? 'border-emerald-700 bg-emerald-900 text-emerald-300'
                                              : 'border-slate-600 text-slate-400 hover:border-emerald-600 hover:text-emerald-400'
                                          }`}
                                        >
                                          {partes[campo] ? '✓' : '○'} {rotulo}
                                        </button>
                                      ))}
                                    </div>
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-700 text-sm font-bold">
                            <td className="pt-2">Total</td>
                            <td className="pt-2 text-right text-emerald-400">{g.total}</td>
                            {g.totalMangaLonga > 0 && (
                              <td className="pt-2 text-right text-amber-400">{g.totalMangaLonga}</td>
                            )}
                            {lote && <td />}
                          </tr>
                        </tfoot>
                      </table>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {g.fichas.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => setFichaAberta(f)}
                            className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-red-500 hover:text-red-400"
                          >
                            Ficha #{f.pedido?.numero ?? '—'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      {g.layoutAnexoId && urlsLayout[g.layoutAnexoId] ? (
                        <a href={urlsLayout[g.layoutAnexoId]} target="_blank" rel="noreferrer">
                          <img
                            src={urlsLayout[g.layoutAnexoId]}
                            alt={`Layout de corte — ${g.modelagem}`}
                            className="max-h-56 w-full rounded-lg border border-slate-700 object-contain"
                          />
                          <p className="mt-1 text-center text-xs text-slate-500">Layout de Corte</p>
                        </a>
                      ) : (
                        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-amber-800 px-4 text-center text-sm text-amber-400">
                          Esta ficha técnica não possui um Layout de Corte definido.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        ))}

      {/* ficha técnica completa */}
      {fichaAberta && (
        <div
          className="fixed inset-0 z-[85] flex items-end justify-center bg-black/70 p-4 md:items-center"
          onClick={() => setFichaAberta(null)}
        >
          <div
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold">{fichaAberta.modelagem}</h3>
                <p className="text-xs text-slate-500">Ficha técnica completa</p>
              </div>
              <button onClick={() => setFichaAberta(null)} className="text-slate-500 hover:text-slate-300">
                ✕
              </button>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {(
                [
                  ['OS / Ficha', fichaAberta.id.slice(0, 8).toUpperCase()],
                  ['Pedido', `#${fichaAberta.pedido?.numero ?? '—'}`],
                  ['Cliente', fichaAberta.pedido?.cliente ?? '—'],
                  ['Data', fichaAberta.pedido?.created_at ? formatarData(fichaAberta.pedido.created_at) : '—'],
                  ['Tecido', fichaAberta.tecido || '—'],
                  ['Gola', fichaAberta.gola || '—'],
                  ['Manga', fichaAberta.manga || '—'],
                  ['Punho', fichaAberta.punho || '—'],
                  ['Estampa', fichaAberta.estampa || '—'],
                ] as const
              ).map(([rotulo, valor]) => (
                <div key={rotulo}>
                  <dt className="text-xs text-slate-500">{rotulo}</dt>
                  <dd className="font-medium">{valor}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-4">
              <p className="text-xs text-slate-500">Grade de tamanhos (pares)</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {gradeEmLinhas(fichaAberta.grade).map((l) => (
                  <span key={l.tamanho} className="rounded-md bg-slate-950 px-2 py-1 text-xs">
                    <span className="font-semibold">{l.tamanho}</span>{' '}
                    <span className="text-slate-400">{l.qtd}</span>
                  </span>
                ))}
              </div>
            </div>

            {fichaAberta.observacoes && (
              <div className="mt-4">
                <p className="text-xs text-slate-500">Observações</p>
                <p className="mt-0.5 text-sm italic text-slate-300">{fichaAberta.observacoes}</p>
              </div>
            )}

            {fichaAberta.layout_anexo_id && urlsLayout[fichaAberta.layout_anexo_id] && (
              <div className="mt-4">
                <p className="mb-1 text-xs text-slate-500">Layout de Corte</p>
                <img
                  src={urlsLayout[fichaAberta.layout_anexo_id]}
                  alt="Layout de corte"
                  className="max-h-56 w-full rounded-lg border border-slate-700 object-contain"
                />
              </div>
            )}

            <Link
              to={`/pedidos/${fichaAberta.pedido?.numero ?? ''}`}
              className="mt-4 block rounded-lg border border-slate-700 py-2 text-center text-sm font-medium hover:bg-slate-800"
            >
              Abrir pedido #{fichaAberta.pedido?.numero ?? ''}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
