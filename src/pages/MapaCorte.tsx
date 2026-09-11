import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import GrupoCorteCard from '../components/GrupoCorteCard'
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
  gradeEmLinhas,
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
        if (tamanhoCortado(lote.progresso?.[chave]?.[l.tamanho], g.partes)) feitos++
      }
    }
    return { feitos, total }
  }, [grupos, lote])

  // resumo do lote: o que interessa de relance antes de começar a cortar
  const totalMangaLonga = grupos?.reduce((a, g) => a + g.totalMangaLonga, 0) ?? 0
  const totalComPunho = grupos?.reduce((a, g) => a + g.totalComPunho, 0) ?? 0
  const pctProgresso = progresso.total ? Math.round((progresso.feitos / progresso.total) * 100) : 0
  const pedidosDoLote = lote ? pedidos.filter((p) => lote.pedido_ids.includes(p.id)) : []
  const todosMarcados = disponiveis.length > 0 && disponiveis.every((p) => selecionados.has(p.id))
  const alternarTodos = () =>
    setSelecionados(todosMarcados ? new Set() : new Set(disponiveis.map((p) => p.id)))
  // no celular as ações ficam numa barra fixa acima da navegação
  const temBarraCelular = aba === 'mapa' && (Boolean(lote) || disponiveis.length > 0)

  // O botão de voz flutua no canto de baixo e cobriria os botões desta
  // barra. A variável faz ele subir só enquanto a barra estiver na tela.
  useEffect(() => {
    const raiz = document.documentElement
    raiz.style.setProperty('--barra-acoes-celular', temBarraCelular ? '4.5rem' : '0px')
    return () => {
      raiz.style.removeProperty('--barra-acoes-celular')
    }
  }, [temBarraCelular])

  /**
   * Botões de ação do mapa. Os mesmos no computador (no topo) e no celular
   * (barra fixa embaixo, na altura do polegar) — muda só o tamanho.
   */
  const acoes = (celular: boolean) => {
    const base = celular
      ? 'flex h-12 items-center justify-center rounded-xl text-sm font-bold'
      : 'rounded-lg px-4 py-2.5 text-sm font-semibold'
    if (!lote) {
      return (
        <button
          onClick={() => void gerar()}
          disabled={gerando || selecionados.size === 0}
          className={`${base} ${celular ? 'flex-1' : ''} bg-red-600 text-white hover:bg-red-500 disabled:opacity-40`}
        >
          {gerando
            ? 'Gerando…'
            : selecionados.size === 0
              ? 'Selecione os pedidos'
              : `Gerar Mapa de Corte (${selecionados.size})`}
        </button>
      )
    }
    return (
      <>
        <button
          onClick={() => void concluirCorte()}
          disabled={concluindo}
          className={`${base} ${celular ? 'flex-1' : ''} bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50`}
        >
          {concluindo ? 'Concluindo…' : '✓ Terminei o corte'}
        </button>
        {grupos && grupos.length > 0 && (
          <button
            onClick={() => void imprimir()}
            disabled={baixando}
            title="Imprimir o mapa em PDF"
            aria-label="Imprimir o mapa em PDF"
            className={`${base} ${celular ? 'w-12' : ''} border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-50`}
          >
            {celular ? (
              baixando ? (
                '…'
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path d="M6 9V2h12v7" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
              )
            ) : baixando ? (
              'Gerando PDF…'
            ) : (
              '↓ Imprimir Mapa'
            )}
          </button>
        )}
        <button
          onClick={() => void descartarLote()}
          title="Descartar o lote sem mover os pedidos"
          aria-label="Descartar o lote sem mover os pedidos"
          className={`${base} ${celular ? 'w-12' : 'px-3'} border border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800`}
        >
          ✕
        </button>
      </>
    )
  }

  return (
    <div className={`space-y-4 md:space-y-5 ${temBarraCelular ? 'pb-20 md:pb-0' : ''}`}>
      {/* ---- título + alternância Mapa / Cortados ---- */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight">Mapa de Corte</h1>
          <p className="text-sm text-slate-400">
            {lote
              ? `Lote aberto desde ${formatarDataHora(lote.created_at)} · ${lote.pedido_ids.length} pedido(s)`
              : 'Selecione os pedidos da etapa de corte — o sistema soma as grades por modelagem'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex w-full rounded-xl border border-slate-700 bg-slate-900 p-1 md:w-auto">
            {(
              [
                ['mapa', 'Mapa'],
                ['relatorio', 'Cortados'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setAba(id)}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors md:flex-none ${
                  aba === id ? 'bg-red-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* no computador as ações ficam aqui; no celular, na barra fixa de baixo */}
          {aba === 'mapa' && (lote || disponiveis.length > 0) && (
            <div className="hidden flex-wrap gap-2 md:flex">{acoes(false)}</div>
          )}
        </div>
      </div>

      {/* histórico do que já foi cortado */}
      {aba === 'relatorio' && <RelatorioCortes />}

      {/* ---- progresso: fica preso no topo enquanto a cortadeira rola a lista ---- */}
      {aba === 'mapa' && lote && progresso.total > 0 && (
        <div className="sticky top-[53px] z-20 -mx-4 border-y border-slate-800 bg-slate-950/95 px-4 py-2.5 backdrop-blur md:static md:mx-0 md:rounded-2xl md:border md:bg-slate-900 md:p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">Progresso do corte</span>
            <span
              className={`text-sm font-bold tabular-nums ${
                progresso.feitos === progresso.total ? 'text-emerald-400' : 'text-slate-300'
              }`}
            >
              {progresso.feitos}/{progresso.total} tamanhos · {pctProgresso}%
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${pctProgresso}%` }}
            />
          </div>
        </div>
      )}

      {/* ---- seleção de pedidos (só quando não há lote aberto) ---- */}
      {aba === 'mapa' && !lote && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-bold">
              Pedidos na etapa de corte
              <span className="ml-1.5 text-sm font-normal text-slate-500">({disponiveis.length})</span>
            </h2>
            <div className="flex gap-2">
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por número ou cliente…"
                className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500 sm:w-64 sm:flex-none"
              />
              {disponiveis.length > 0 && (
                <button
                  onClick={alternarTodos}
                  className="shrink-0 rounded-xl border border-slate-700 px-3 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                >
                  {todosMarcados ? 'Limpar' : 'Todos'}
                </button>
              )}
            </div>
          </div>

          {disponiveis.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {idsEtapaCorte.size === 0
                ? 'Nenhuma etapa chamada "Corte" no fluxo de produção — crie ou renomeie uma em Admin → Fluxo.'
                : busca
                  ? 'Nenhum pedido encontrado na busca.'
                  : 'Nenhum pedido na etapa de corte no momento.'}
            </p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {disponiveis.map((p) => {
                const marcado = selecionados.has(p.id)
                const temFicha = comFicha.has(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => alternar(p.id)}
                    aria-pressed={marcado}
                    className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      marcado
                        ? 'border-red-500 bg-red-950/40'
                        : 'border-slate-800 bg-slate-950/40 hover:border-slate-600'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-xs font-black ${
                        marcado ? 'border-red-500 bg-red-600 text-white' : 'border-slate-600'
                      }`}
                    >
                      {marcado && '✓'}
                    </span>
                    <span className="min-w-0 flex-1 leading-snug">
                      <span className="mr-1.5 font-black text-red-400">#{p.numero}</span>
                      <span className="text-sm font-medium text-slate-200">{p.cliente}</span>
                    </span>
                    {!temFicha && (
                      <span
                        className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400"
                        title="Pedido sem ficha técnica — não entra no mapa"
                      >
                        sem ficha
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* ---- resumo do lote aberto ---- */}
      {aba === 'mapa' && lote && grupos && grupos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:gap-3">
          {(
            [
              ['Peças no lote', totalGeral, 'text-emerald-400'],
              ['Modelagens', grupos.length, 'text-slate-100'],
              ['Manga longa', totalMangaLonga, 'text-amber-300'],
              ['Com punho', totalComPunho, 'text-sky-300'],
            ] as const
          ).map(([rotulo, valor, cor]) => (
            <div key={rotulo} className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
              <p className={`text-3xl font-black leading-none tabular-nums ${valor > 0 ? cor : 'text-slate-600'}`}>
                {valor}
              </p>
              <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{rotulo}</p>
            </div>
          ))}
        </div>
      )}

      {aba === 'mapa' && lote && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Pedidos deste lote
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {pedidosDoLote.map((p) => (
              <Link
                key={p.id}
                to={`/pedidos/${p.numero}`}
                className="min-h-9 rounded-full border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-300 hover:border-red-500 hover:text-red-400"
              >
                <span className="font-bold text-red-400">#{p.numero}</span> · {p.cliente}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ---- grupos do mapa ---- */}
      {aba === 'mapa' &&
        grupos &&
        (grupos.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-700 py-10 text-center text-sm text-slate-500">
            Os pedidos selecionados não têm fichas técnicas cadastradas.
          </p>
        ) : (
          grupos.map((g) => (
            <GrupoCorteCard
              key={g.chave}
              grupo={g}
              progresso={lote?.progresso?.[g.chave]}
              comLote={Boolean(lote)}
              urlLayout={g.layoutAnexoId ? urlsLayout[g.layoutAnexoId] : undefined}
              onAlternarParte={(tamanho, campo) => void alternarParte(g.chave, tamanho, campo)}
              onAbrirFicha={setFichaAberta}
            />
          ))
        ))}

      {/* ---- barra de ações do celular: na altura do polegar, acima da navegação ---- */}
      {temBarraCelular && (
        <div className="fixed inset-x-0 bottom-[calc(3.625rem+env(safe-area-inset-bottom))] z-30 border-t border-slate-800 bg-slate-950/95 px-4 py-2.5 backdrop-blur md:hidden">
          <div className="flex gap-2">{acoes(true)}</div>
        </div>
      )}

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
