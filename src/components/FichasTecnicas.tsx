import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { enviarAnexo, urlsAnexos } from '../lib/anexos'
import { supabase } from '../lib/supabase'
import type { Anexo, FichaTecnica, Grade } from '../types'
import { gradeEmLinhas, ordenarTamanhos, totalDaGrade } from '../utils/corte'
import type { FichaLida } from '../utils/fichaArquivo'
import { comprimirImagem } from '../utils/imagem'

const TAMANHOS_PADRAO = ['PP', 'P', 'M', 'G', 'GG', 'XG']

const vazia = (pedidoId: string): Partial<FichaTecnica> => ({
  pedido_id: pedidoId,
  modelagem: '',
  tecido: '',
  gola: '',
  manga: '',
  punho: '',
  estampa: '',
  grade: {},
  observacoes: '',
})

/**
 * Fichas técnicas do pedido: uma por modelagem, com grade de tamanhos,
 * imagens próprias e a marcação exclusiva de "Layout de Corte".
 * Cada unidade da grade = 1 par (frente + costa).
 */
export default function FichasTecnicas({ pedidoId, numeroPedido }: { pedidoId: string; numeroPedido: number }) {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const [fichas, setFichas] = useState<FichaTecnica[]>([])
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [editando, setEditando] = useState<Partial<FichaTecnica> | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [lendoPdf, setLendoPdf] = useState(false)
  const [avisosPdf, setAvisosPdf] = useState<string[]>([])
  // resultado da importação aguardando conferência do usuário
  const [importado, setImportado] = useState<FichaLida | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const pdfRef = useRef<HTMLInputElement>(null)

  const carregar = async () => {
    const [f, a] = await Promise.all([
      supabase.from('fichas_tecnicas').select('*').eq('pedido_id', pedidoId).order('created_at'),
      supabase.from('anexos').select('*').eq('pedido_id', pedidoId).not('ficha_id', 'is', null),
    ])
    if (f.error) toast(f.error.message, 'erro')
    setFichas((f.data as FichaTecnica[]) ?? [])
    const lista = (a.data as Anexo[]) ?? []
    setAnexos(lista)
    const imagens = lista.filter((x) => x.tipo.startsWith('image/'))
    setUrls(imagens.length > 0 ? await urlsAnexos(imagens.map((x) => x.path), { miniatura: true }) : {})
  }

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoId])

  /**
   * Importa a ficha de um PDF ou DOCX (leitura direta do texto — sem OCR).
   * Uma ficha pode ter VÁRIAS modelagens: abre a tela de conferência com
   * todas elas para o usuário revisar antes de criar.
   */
  const importarArquivo = async (file: File) => {
    setLendoPdf(true)
    setAvisosPdf([])
    setImportado(null)
    try {
      const { lerFichaArquivo } = await import('../utils/fichaArquivo')
      const lida = await lerFichaArquivo(file)
      setAvisosPdf(lida.avisos)
      if (lida.modelagens.length === 0) {
        // sem tabela reconhecida: abre o formulário em branco com o cabeçalho
        setEditando({
          pedido_id: pedidoId,
          modelagem: lida.manga,
          tecido: lida.tecido,
          gola: lida.gola,
          manga: lida.manga,
          punho: lida.punho,
          estampa: lida.estampa,
          grade: {},
          observacoes: lida.observacoes,
        })
        toast('Li o cabeçalho, mas não achei a tabela de tamanhos. Preencha a grade.', 'info')
        return
      }
      setImportado(lida)
      toast(
        `${lida.modelagens.length} modelagem(ns) lida(s) • ${lida.total} peças. Confira antes de criar.`,
        'sucesso',
      )
    } catch (e) {
      toast(`Não consegui ler o arquivo: ${e instanceof Error ? e.message : ''}`, 'erro')
    } finally {
      setLendoPdf(false)
    }
  }

  /** cria uma ficha para cada modelagem conferida na importação */
  const confirmarImportacao = async () => {
    if (!importado) return
    setSalvando(true)
    const novas = importado.modelagens.map((m) => ({
      pedido_id: pedidoId,
      modelagem: m.modelagem,
      tecido: importado.tecido,
      gola: importado.gola,
      manga: importado.manga,
      punho: importado.punho,
      estampa: importado.estampa,
      grade: m.grade,
      observacoes: importado.observacoes,
    }))
    const { error } = await supabase.from('fichas_tecnicas').insert(novas)
    setSalvando(false)
    if (error) toast(error.message, 'erro')
    else {
      toast(`${novas.length} ficha(s) criada(s).`, 'sucesso')
      setImportado(null)
      setAvisosPdf([])
      void carregar()
    }
  }

  /** fecha o formulário e limpa os avisos da leitura do PDF */
  const fecharForm = () => {
    setEditando(null)
    setAvisosPdf([])
  }

  const salvar = async () => {
    if (!editando) return
    const modelagem = (editando.modelagem ?? '').trim()
    if (!modelagem) {
      toast('Informe a modelagem (ex.: Manga Curta).', 'erro')
      return
    }
    setSalvando(true)
    const dados = {
      pedido_id: pedidoId,
      modelagem,
      tecido: editando.tecido ?? '',
      gola: editando.gola ?? '',
      manga: editando.manga ?? '',
      punho: editando.punho ?? '',
      estampa: editando.estampa ?? '',
      grade: editando.grade ?? {},
      observacoes: editando.observacoes ?? '',
    }
    const { error } = editando.id
      ? await supabase.from('fichas_tecnicas').update(dados).eq('id', editando.id)
      : await supabase.from('fichas_tecnicas').insert(dados)
    setSalvando(false)
    if (error) toast(error.message, 'erro')
    else {
      toast(editando.id ? 'Ficha atualizada.' : 'Ficha técnica criada.', 'sucesso')
      fecharForm()
      void carregar()
    }
  }

  const excluirFicha = async (f: FichaTecnica) => {
    if (!confirm(`Excluir a ficha "${f.modelagem}"? As imagens dela também serão removidas.`)) return
    const { error } = await supabase.from('fichas_tecnicas').delete().eq('id', f.id)
    if (error) toast(error.message, 'erro')
    else void carregar()
  }

  const enviarImagem = async (ficha: FichaTecnica, original: File) => {
    setEnviando(ficha.id)
    try {
      const file = await comprimirImagem(original)
      const path = await enviarAnexo(file, numeroPedido)
      const { data: userData } = await supabase.auth.getUser()
      const { error } = await supabase.from('anexos').insert({
        pedido_id: pedidoId,
        ficha_id: ficha.id,
        nome: file.name,
        path,
        tipo: file.type,
        tamanho: file.size,
        uploaded_by: userData.user?.id,
      })
      if (error) throw new Error(error.message)
      toast('Imagem anexada à ficha.', 'sucesso')
      await carregar()
    } catch (e) {
      toast(`Falha ao anexar: ${e instanceof Error ? e.message : ''}`, 'erro')
    } finally {
      setEnviando(null)
    }
  }

  /** marca a imagem como Layout de Corte (exclusivo: substitui o anterior) */
  const definirLayout = async (ficha: FichaTecnica, anexoId: string) => {
    const novo = ficha.layout_anexo_id === anexoId ? null : anexoId
    setFichas((arr) => arr.map((x) => (x.id === ficha.id ? { ...x, layout_anexo_id: novo } : x)))
    const { error } = await supabase
      .from('fichas_tecnicas')
      .update({ layout_anexo_id: novo })
      .eq('id', ficha.id)
    if (error) {
      toast(error.message, 'erro')
      void carregar()
    }
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500'

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Fichas técnicas ({fichas.length})
          <span className="ml-2 text-xs font-normal text-slate-500">uma por modelagem</span>
        </h2>
        {isAdmin && (
          <div className="flex gap-2">
            {/* leitura automática do PDF da ficha (texto direto, sem OCR) */}
            <input
              ref={pdfRef}
              type="file"
              hidden
              accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importarArquivo(f)
                e.target.value = ''
              }}
            />
            <button
              onClick={() => pdfRef.current?.click()}
              disabled={lendoPdf}
              className="rounded-lg border border-emerald-800 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-950 disabled:opacity-50"
            >
              {lendoPdf ? 'Lendo arquivo…' : 'Importar ficha (PDF/Word)'}
            </button>
            <button
              onClick={() => setEditando(vazia(pedidoId))}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700"
            >
              + Nova ficha
            </button>
          </div>
        )}
      </div>

      {fichas.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          Nenhuma ficha técnica. {isAdmin && 'Crie uma para usar o Mapa de Corte.'}
        </p>
      ) : (
        <div className="space-y-3">
          {fichas.map((f) => {
            const imagens = anexos.filter((a) => a.ficha_id === f.id && a.tipo.startsWith('image/'))
            const linhas = gradeEmLinhas(f.grade)
            return (
              <div key={f.id} className="rounded-lg border border-slate-800 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{f.modelagem}</p>
                    <p className="text-xs text-slate-500">
                      {[f.tecido, f.gola, f.manga, f.punho, f.estampa].filter(Boolean).join(' • ') || 'sem detalhes'}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300">
                    {totalDaGrade(f.grade)} pares
                  </span>
                </div>

                {/* grade de tamanhos */}
                {linhas.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {linhas.map((l) => (
                      <span key={l.tamanho} className="rounded-md bg-slate-950 px-2 py-1 text-xs">
                        <span className="font-semibold">{l.tamanho}</span>{' '}
                        <span className="text-slate-400">{l.qtd}</span>
                      </span>
                    ))}
                  </div>
                )}

                {f.observacoes && <p className="mt-2 text-xs italic text-slate-500">{f.observacoes}</p>}

                {/* imagens da ficha + seletor de Layout de Corte */}
                <div className="mt-3">
                  {imagens.length === 0 ? (
                    <p className="text-xs text-amber-400">
                      Esta ficha técnica não possui um Layout de Corte definido.
                    </p>
                  ) : (
                    <>
                      {!f.layout_anexo_id && (
                        <p className="mb-2 text-xs text-amber-400">
                          Esta ficha técnica não possui um Layout de Corte definido.
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {imagens.map((a) => {
                          const marcado = f.layout_anexo_id === a.id
                          return (
                            <div
                              key={a.id}
                              className={`overflow-hidden rounded-lg border ${marcado ? 'border-emerald-500' : 'border-slate-800'}`}
                            >
                              {urls[a.path] && (
                                <img src={urls[a.path]} alt={a.nome} loading="lazy" className="h-20 w-full object-cover" />
                              )}
                              <button
                                onClick={() => isAdmin && void definirLayout(f, a.id)}
                                disabled={!isAdmin}
                                className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] transition-colors ${
                                  marcado ? 'bg-emerald-950 text-emerald-300' : 'text-slate-400 hover:text-slate-200'
                                } disabled:cursor-default`}
                              >
                                <span
                                  className={`inline-block h-3 w-3 shrink-0 rounded-full border ${
                                    marcado ? 'border-emerald-400 bg-emerald-400' : 'border-slate-500'
                                  }`}
                                />
                                Layout de Corte
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}

                  {isAdmin && (
                    <div className="mt-2 flex gap-2">
                      <input
                        ref={(el) => {
                          fileRefs.current[f.id] = el
                        }}
                        type="file"
                        hidden
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) void enviarImagem(f, file)
                          e.target.value = ''
                        }}
                      />
                      <button
                        onClick={() => fileRefs.current[f.id]?.click()}
                        disabled={enviando === f.id}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
                      >
                        {enviando === f.id ? 'Enviando…' : '+ Imagem'}
                      </button>
                      <button
                        onClick={() => setEditando(f)}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-800"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => void excluirFicha(f)}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-slate-800"
                      >
                        Excluir
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* conferência da importação: mostra TODAS as modelagens lidas antes de criar */}
      {importado && (
        <div
          className="fixed inset-0 z-[85] flex items-end justify-center bg-black/60 p-4 md:items-center"
          onClick={() => setImportado(null)}
        >
          <div
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold">Conferir importação</h3>
            <p className="mt-1 text-xs text-slate-500">
              {importado.modelagens.length} modelagem(ns) • {importado.total} peças no total. Nada é
              salvo até você confirmar.
            </p>

            {avisosPdf.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-800 bg-amber-950/40 p-2.5 text-xs text-amber-300">
                <ul className="list-inside list-disc">
                  {avisosPdf.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* cabeçalho lido */}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-slate-950 p-3 text-sm">
              {(
                [
                  ['OS', importado.os],
                  ['Cliente', importado.cliente],
                  ['Tecido', importado.tecido],
                  ['Gola', importado.gola],
                  ['Manga', importado.manga],
                  ['Punho', importado.punho],
                  ['Estampa', importado.estampa],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([rotulo, valor]) => (
                  <div key={rotulo}>
                    <dt className="text-[11px] text-slate-500">{rotulo}</dt>
                    <dd className="font-medium">{valor}</dd>
                  </div>
                ))}
            </dl>

            {/* uma ficha por modelagem */}
            <div className="mt-3 space-y-2">
              {importado.modelagens.map((m, i) => (
                <div key={`${m.modelagem}-${i}`} className="rounded-lg border border-slate-800 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <input
                      value={m.modelagem}
                      onChange={(e) => {
                        const modelagens = [...importado.modelagens]
                        modelagens[i] = { ...m, modelagem: e.target.value }
                        setImportado({ ...importado, modelagens })
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm font-semibold outline-none focus:border-red-500"
                    />
                    <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                      {m.total} pares
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {gradeEmLinhas(m.grade).map((l) => (
                      <span key={l.tamanho} className="rounded-md bg-slate-950 px-2 py-1 text-xs">
                        <span className="font-semibold">{l.tamanho}</span>{' '}
                        <span className="text-slate-400">{l.qtd}</span>
                      </span>
                    ))}
                  </div>
                  {m.totalDeclarado != null && m.totalDeclarado === m.total && (
                    <p className="mt-1.5 text-[11px] text-emerald-400">
                      Confere com o total declarado na ficha ({m.totalDeclarado}).
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setImportado(null)}
                className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm font-medium hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={() => void confirmarImportacao()}
                disabled={salvando}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {salvando ? 'Criando…' : `Criar ${importado.modelagens.length} ficha(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* modal de criação/edição */}
      {editando && (
        <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/60 p-4 md:items-center"
          onClick={() => fecharForm()}>
          <div
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold">{editando.id ? 'Editar ficha técnica' : 'Nova ficha técnica'}</h3>

            {/* conferência da leitura do PDF: nada é salvo sem o usuário revisar */}
            {avisosPdf.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-800 bg-amber-950/40 p-2.5 text-xs text-amber-300">
                <p className="font-semibold">Confira antes de salvar:</p>
                <ul className="mt-1 list-inside list-disc">
                  {avisosPdf.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-400">Modelagem *</label>
                <input
                  value={editando.modelagem ?? ''}
                  onChange={(e) => setEditando({ ...editando, modelagem: e.target.value })}
                  placeholder="ex.: Manga Curta, Manga Longa, Raglan"
                  className={inputCls}
                />
              </div>
              {([
                ['tecido', 'Tecido'],
                ['gola', 'Modelo da gola'],
                ['manga', 'Modelo da manga'],
                ['punho', 'Punho'],
                ['estampa', 'Tipo de estampa'],
              ] as const).map(([campo, rotulo]) => (
                <div key={campo}>
                  <label className="text-xs font-medium text-slate-400">{rotulo}</label>
                  <input
                    value={(editando[campo] as string) ?? ''}
                    onChange={(e) => setEditando({ ...editando, [campo]: e.target.value })}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>

            {/* grade de tamanhos */}
            <div className="mt-4">
              <label className="text-xs font-medium text-slate-400">
                Grade de tamanhos
                <span className="ml-1 text-slate-600">(cada unidade = 1 par: frente + costa)</span>
              </label>
              <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {ordenarTamanhos([
                  ...new Set([...TAMANHOS_PADRAO, ...Object.keys(editando.grade ?? {})]),
                ]).map((t) => (
                  <div key={t}>
                    <span className="block text-center text-[11px] font-semibold text-slate-400">{t}</span>
                    <input
                      type="number"
                      min={0}
                      value={(editando.grade as Grade | undefined)?.[t] ?? ''}
                      onChange={(e) => {
                        const g: Grade = { ...(editando.grade ?? {}) }
                        const n = parseInt(e.target.value, 10)
                        if (!n || n <= 0) delete g[t]
                        else g[t] = n
                        setEditando({ ...editando, grade: g })
                      }}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-center text-sm outline-none focus:border-red-500"
                    />
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-right text-xs text-slate-500">
                Total: <span className="font-semibold text-slate-300">{totalDaGrade(editando.grade)} pares</span>
              </p>
            </div>

            <div className="mt-3">
              <label className="text-xs font-medium text-slate-400">Observações</label>
              <textarea
                rows={2}
                value={editando.observacoes ?? ''}
                onChange={(e) => setEditando({ ...editando, observacoes: e.target.value })}
                className={inputCls}
              />
            </div>

            <div className="mt-5 flex gap-3">
              <button
                onClick={() => fecharForm()}
                className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm font-medium hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={() => void salvar()}
                disabled={salvando}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
