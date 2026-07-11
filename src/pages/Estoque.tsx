import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { supabase } from '../lib/supabase'
import type { EstoqueCategoria, EstoqueItem } from '../types'

/** Formata a quantidade como inteiro quando não tem casas decimais. */
const fmtQtd = (v: number | string) => {
  const n = Number(v)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/**
 * Estoque: categorias (tópicos, ex.: Dry Fit, Caneca) que expandem em itens
 * (subtópicos, ex.: Dry Fit texturizado, Caneca 800) com quantidade.
 * Todos veem; apenas admin cria, edita e remove.
 */
export default function Estoque() {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const [categorias, setCategorias] = useState<EstoqueCategoria[]>([])
  const [itens, setItens] = useState<EstoqueItem[]>([])
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [busca, setBusca] = useState('')
  const [novaCategoria, setNovaCategoria] = useState('')
  const [novoItem, setNovoItem] = useState<Record<string, string>>({})

  const carregar = async () => {
    const [c, i] = await Promise.all([
      supabase.from('estoque_categorias').select('*').order('nome'),
      supabase.from('estoque_itens').select('*').order('nome'),
    ])
    // se a leitura falhar (ex.: política ausente), mostra o motivo em vez de ficar vazio silenciosamente
    if (c.error) toast(`Erro ao carregar categorias: ${c.error.message}`, 'erro')
    if (i.error) toast(`Erro ao carregar itens: ${i.error.message}`, 'erro')
    setCategorias((c.data as EstoqueCategoria[]) ?? [])
    setItens((i.data as EstoqueItem[]) ?? [])
  }

  useEffect(() => {
    carregar()
    const canal = supabase
      .channel(`estoque-rt-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estoque_categorias' }, carregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estoque_itens' }, carregar)
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [])

  const itensPorCategoria = useMemo(() => {
    const mapa: Record<string, EstoqueItem[]> = {}
    for (const it of itens) (mapa[it.categoria_id] ??= []).push(it)
    return mapa
  }, [itens])

  const q = busca.toLowerCase().trim()
  const categoriasVisiveis = useMemo(
    () =>
      categorias.filter(
        (c) =>
          !q ||
          c.nome.toLowerCase().includes(q) ||
          (itensPorCategoria[c.id] ?? []).some((it) => it.nome.toLowerCase().includes(q)),
      ),
    [categorias, itensPorCategoria, q],
  )

  const toggle = (id: string) =>
    setExpandidas((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  // ---------- ações de admin ----------
  const addCategoria = async () => {
    const nome = novaCategoria.trim()
    if (!nome) {
      toast('Digite o nome da categoria no campo ao lado do botão "+ Categoria".', 'erro')
      return
    }
    const { data, error } = await supabase.from('estoque_categorias').insert({ nome }).select()
    if (error) {
      toast(error.message, 'erro')
      return
    }
    setNovaCategoria('')
    const criada = (data as EstoqueCategoria[] | null)?.[0]
    // mostra na hora, sem depender do recarregamento
    if (criada) {
      setCategorias((arr) =>
        [...arr, criada].sort((a, b) => a.nome.localeCompare(b.nome)),
      )
    }
    toast(`Categoria "${nome}" criada.`, 'sucesso')
    carregar()
  }

  const renomearCategoria = async (c: EstoqueCategoria) => {
    const nome = prompt('Novo nome da categoria:', c.nome)?.trim()
    if (!nome || nome === c.nome) return
    const { error } = await supabase.from('estoque_categorias').update({ nome }).eq('id', c.id)
    if (error) toast(error.message, 'erro')
    else carregar()
  }

  const excluirCategoria = async (c: EstoqueCategoria) => {
    const n = (itensPorCategoria[c.id] ?? []).length
    if (
      !confirm(
        `Excluir a categoria "${c.nome}"${n ? ` e seus ${n} item(ns)` : ''}? Essa ação não pode ser desfeita.`,
      )
    )
      return
    const { error } = await supabase.from('estoque_categorias').delete().eq('id', c.id)
    if (error) toast(error.message, 'erro')
    else carregar()
  }

  const addItem = async (categoriaId: string) => {
    const nome = (novoItem[categoriaId] ?? '').trim()
    if (!nome) {
      toast('Digite o nome do item antes de clicar em Adicionar.', 'erro')
      return
    }
    const { data, error } = await supabase
      .from('estoque_itens')
      .insert({ categoria_id: categoriaId, nome })
      .select()
    if (error) {
      toast(error.message, 'erro')
      return
    }
    setNovoItem((m) => ({ ...m, [categoriaId]: '' }))
    const criado = (data as EstoqueItem[] | null)?.[0]
    if (criado) setItens((arr) => [...arr, criado])
    // garante que a categoria esteja aberta para o item aparecer
    setExpandidas((s) => new Set(s).add(categoriaId))
    carregar()
  }

  const setQtdLocal = (id: string, q: number) =>
    setItens((arr) => arr.map((x) => (x.id === id ? { ...x, quantidade: q } : x)))

  // Ajuste por delta: funcionário pode diminuir; aumentar só admin (validado no banco).
  // Passa pela função ajustar_estoque (atualização otimista + reconciliação com o servidor).
  const ajustar = async (it: EstoqueItem, delta: number) => {
    setQtdLocal(it.id, Math.max(0, Number(it.quantidade) + delta))
    const { data, error } = await supabase.rpc('ajustar_estoque', {
      p_item_id: it.id,
      p_delta: delta,
    })
    if (error) {
      toast(error.message, 'erro')
      carregar()
    } else if (data != null) {
      setQtdLocal(it.id, Number(data))
    }
  }

  // Definir valor exato: apenas admin (usa update direto, protegido por RLS)
  const definirQtd = async (it: EstoqueItem) => {
    const txt = prompt(`Quantidade de "${it.nome}":`, String(it.quantidade))
    if (txt == null) return
    const novo = Math.max(0, Number(txt.replace(',', '.')) || 0)
    setQtdLocal(it.id, novo)
    const { error } = await supabase.from('estoque_itens').update({ quantidade: novo }).eq('id', it.id)
    if (error) {
      toast(error.message, 'erro')
      carregar()
    }
  }

  const renomearItem = async (it: EstoqueItem) => {
    const nome = prompt('Novo nome do item:', it.nome)?.trim()
    if (!nome || nome === it.nome) return
    const { error } = await supabase.from('estoque_itens').update({ nome }).eq('id', it.id)
    if (error) toast(error.message, 'erro')
    else carregar()
  }

  const excluirItem = async (it: EstoqueItem) => {
    if (!confirm(`Excluir o item "${it.nome}"?`)) return
    const { error } = await supabase.from('estoque_itens').delete().eq('id', it.id)
    if (error) toast(error.message, 'erro')
    else carregar()
  }

  const inputCls =
    'rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-red-500'
  const totalItens = itens.length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">Estoque</h1>
        <p className="text-sm text-slate-400">
          {categorias.length} categoria(s) • {totalItens} item(ns)
        </p>
      </div>

      {/* Busca */}
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar categoria ou item…"
        className={`${inputCls} w-full`}
      />

      {/* Nova categoria (admin) */}
      {isAdmin && (
        <div className="flex gap-2">
          <input
            value={novaCategoria}
            onChange={(e) => setNovaCategoria(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addCategoria()}
            placeholder="Nova categoria (ex.: Dry Fit, Caneca, Linha, Papel)"
            className={`${inputCls} min-w-0 flex-1`}
          />
          <button
            onClick={() => void addCategoria()}
            className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
          >
            + Categoria
          </button>
        </div>
      )}

      {categoriasVisiveis.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-500">
          {categorias.length === 0
            ? isAdmin
              ? 'Nenhuma categoria ainda. Crie a primeira acima.'
              : 'Nenhuma categoria cadastrada.'
            : 'Nada encontrado para a busca.'}
        </p>
      ) : (
        <div className="space-y-2">
          {categoriasVisiveis.map((c) => {
            const lista = itensPorCategoria[c.id] ?? []
            const catMatch = !q || c.nome.toLowerCase().includes(q)
            const itensCat = lista.filter((it) => catMatch || it.nome.toLowerCase().includes(q))
            const aberta = q ? true : expandidas.has(c.id)
            return (
              <div key={c.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
                {/* Cabeçalho da categoria */}
                <div className="flex items-center gap-2 p-3">
                  <button
                    onClick={() => toggle(c.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className={`text-slate-500 transition-transform ${aberta ? 'rotate-90' : ''}`}>
                      ▶
                    </span>
                    <span className="truncate font-semibold">{c.nome}</span>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-400">
                      {lista.length}
                    </span>
                  </button>
                  {isAdmin && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() => void renomearCategoria(c)}
                        title="Renomear categoria"
                        className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:text-amber-400"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => void excluirCategoria(c)}
                        title="Excluir categoria"
                        className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:text-rose-400"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                {/* Itens da categoria */}
                {aberta && (
                  <div className="space-y-2 border-t border-slate-800 p-3">
                    {itensCat.length === 0 && (
                      <p className="text-sm text-slate-500">Nenhum item nesta categoria.</p>
                    )}
                    {itensCat.map((it) => {
                      const semEstoque = Number(it.quantidade) <= 0
                      return (
                        <div key={it.id} className="flex items-center gap-2">
                          {isAdmin ? (
                            <button
                              onClick={() => void renomearItem(it)}
                              title="Renomear item"
                              className="min-w-0 flex-1 truncate text-left text-sm hover:text-amber-400"
                            >
                              {it.nome}
                            </button>
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-sm">{it.nome}</span>
                          )}
                          <div className="flex shrink-0 items-center gap-1">
                            {/* − diminuir: disponível para todos (funcionário registra o consumo) */}
                            <button
                              onClick={() => void ajustar(it, -1)}
                              disabled={semEstoque}
                              title="Usei um / dar baixa"
                              className="h-7 w-7 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              −
                            </button>
                            {/* quantidade: admin clica para definir valor exato */}
                            {isAdmin ? (
                              <button
                                onClick={() => void definirQtd(it)}
                                title="Definir quantidade exata"
                                className={`min-w-[3rem] rounded-md px-2 py-1 text-center text-sm font-semibold tabular-nums hover:bg-slate-800 ${
                                  semEstoque ? 'bg-rose-950 text-rose-300' : 'bg-slate-950'
                                }`}
                              >
                                {fmtQtd(it.quantidade)}
                              </button>
                            ) : (
                              <span
                                className={`min-w-[3rem] rounded-md px-2 py-1 text-center text-sm font-semibold tabular-nums ${
                                  semEstoque ? 'bg-rose-950 text-rose-300' : 'bg-slate-950 text-slate-300'
                                }`}
                              >
                                {fmtQtd(it.quantidade)}
                              </span>
                            )}
                            {/* + aumentar e ✕ excluir: só admin */}
                            {isAdmin && (
                              <>
                                <button
                                  onClick={() => void ajustar(it, 1)}
                                  className="h-7 w-7 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700"
                                >
                                  +
                                </button>
                                <button
                                  onClick={() => void excluirItem(it)}
                                  title="Excluir item"
                                  className="ml-1 h-7 w-7 rounded-md bg-slate-800 text-slate-400 hover:text-rose-400"
                                >
                                  ✕
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Novo item (admin) */}
                    {isAdmin && (
                      <div className="flex gap-2 pt-1">
                        <input
                          value={novoItem[c.id] ?? ''}
                          onChange={(e) => setNovoItem((m) => ({ ...m, [c.id]: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && void addItem(c.id)}
                          placeholder="Novo item (ex.: Dry Fit texturizado, Caneca 800)"
                          className={`${inputCls} min-w-0 flex-1`}
                        />
                        <button
                          onClick={() => void addItem(c.id)}
                          className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium hover:bg-slate-800"
                        >
                          Adicionar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
