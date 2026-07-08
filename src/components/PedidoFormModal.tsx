import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import type { Pedido, Prioridade } from '../types'

/** Modal de criação/edição de pedido (apenas admin), com anexo de imagens/arquivos. */
export default function PedidoFormModal({
  pedido,
  onFechar,
  onSalvo,
}: {
  pedido?: Pedido | null
  onFechar: () => void
  onSalvo: () => void
}) {
  const toast = useToast()
  const editando = Boolean(pedido)
  const [numero, setNumero] = useState(pedido?.numero?.toString() ?? '')
  const [cliente, setCliente] = useState(pedido?.cliente ?? '')
  const [descricao, setDescricao] = useState(pedido?.descricao ?? '')
  const [quantidade, setQuantidade] = useState(pedido?.quantidade?.toString() ?? '1')
  const [prioridade, setPrioridade] = useState<Prioridade>(pedido?.prioridade ?? 'normal')
  const [dataPrevista, setDataPrevista] = useState(pedido?.data_prevista ?? '')
  const [arquivos, setArquivos] = useState<File[]>([])
  const [salvando, setSalvando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // pré-visualização das imagens selecionadas
  const [previews, setPreviews] = useState<Record<string, string>>({})
  useEffect(() => {
    const urls: Record<string, string> = {}
    for (const f of arquivos) {
      if (f.type.startsWith('image/')) urls[`${f.name}-${f.size}`] = URL.createObjectURL(f)
    }
    setPreviews(urls)
    return () => {
      for (const u of Object.values(urls)) URL.revokeObjectURL(u)
    }
  }, [arquivos])

  const adicionarArquivos = (lista: FileList | null) => {
    if (!lista) return
    setArquivos((atual) => [...atual, ...Array.from(lista)])
  }

  const removerArquivo = (idx: number) => {
    setArquivos((atual) => atual.filter((_, i) => i !== idx))
  }

  /** Envia os arquivos selecionados para o Storage e registra na tabela anexos */
  const enviarAnexos = async (pedidoId: string, numeroPedido: number) => {
    if (arquivos.length === 0) return true
    const { data: userData } = await supabase.auth.getUser()
    let falhas = 0
    for (const file of arquivos) {
      const path = `${numeroPedido}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`
      const { error: upErr } = await supabase.storage.from('anexos').upload(path, file)
      if (upErr) {
        falhas++
        continue
      }
      const { error } = await supabase.from('anexos').insert({
        pedido_id: pedidoId,
        nome: file.name,
        path,
        tipo: file.type,
        tamanho: file.size,
        uploaded_by: userData.user?.id,
      })
      if (error) falhas++
    }
    if (falhas > 0) toast(`${falhas} arquivo(s) não puderam ser anexados.`, 'erro')
    return falhas === 0
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSalvando(true)
    const num = parseInt(numero, 10)
    let error
    let pedidoId = pedido?.id ?? null

    if (editando && pedido) {
      ;({ error } = await supabase
        .from('pedidos')
        .update({
          numero: num,
          cliente,
          descricao,
          quantidade: parseInt(quantidade, 10) || 1,
          prioridade,
          data_prevista: dataPrevista || null,
        })
        .eq('id', pedido.id))
    } else {
      const res = await supabase.rpc('criar_pedido', {
        p_numero: num,
        p_cliente: cliente,
        p_descricao: descricao,
        p_quantidade: parseInt(quantidade, 10) || 1,
        p_prioridade: prioridade,
        p_data_prevista: dataPrevista || null,
      })
      error = res.error
      pedidoId = (res.data as string | null) ?? null
    }

    if (error) {
      setSalvando(false)
      toast(
        error.message.includes('duplicate') ? `Já existe um pedido nº ${numero}.` : error.message,
        'erro',
      )
      return
    }

    if (pedidoId) await enviarAnexos(pedidoId, num)

    setSalvando(false)
    toast(editando ? 'Pedido atualizado.' : `Pedido ${numero} criado.`, 'sucesso')
    onSalvo()
    onFechar()
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-sky-500'

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 md:items-center">
      <form
        onSubmit={submit}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <h2 className="text-lg font-bold">{editando ? `Editar pedido ${pedido?.numero}` : 'Novo pedido'}</h2>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-400">Número *</label>
            <input
              type="number"
              required
              min={1}
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400">Quantidade</label>
            <input
              type="number"
              min={1}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="text-xs font-medium text-slate-400">Cliente *</label>
          <input required value={cliente} onChange={(e) => setCliente(e.target.value)} className={inputCls} />
        </div>

        <div className="mt-3">
          <label className="text-xs font-medium text-slate-400">Descrição</label>
          <textarea
            rows={2}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className={inputCls}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-400">Prioridade</label>
            <select
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value as Prioridade)}
              className={inputCls}
            >
              <option value="baixa">Baixa</option>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400">Entrega prevista</label>
            <input
              type="date"
              value={dataPrevista}
              onChange={(e) => setDataPrevista(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* Anexos: imagens, artes, PDFs */}
        <div className="mt-4">
          <label className="text-xs font-medium text-slate-400">
            Imagens e arquivos {arquivos.length > 0 && `(${arquivos.length})`}
          </label>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="image/*,.pdf,.ai,.psd,.cdr,.doc,.docx,.xls,.xlsx"
            onChange={(e) => {
              adicionarArquivos(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-600 py-3 text-sm text-slate-400 transition-colors hover:border-sky-500 hover:text-sky-400"
          >
            📷 Adicionar imagem ou arquivo
          </button>

          {arquivos.length > 0 && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {arquivos.map((f, idx) => {
                const preview = previews[`${f.name}-${f.size}`]
                return (
                  <div
                    key={`${f.name}-${f.size}-${idx}`}
                    className="group relative overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
                  >
                    {preview ? (
                      <img src={preview} alt={f.name} className="h-20 w-full object-cover" />
                    ) : (
                      <div className="flex h-20 w-full items-center justify-center text-2xl">
                        {f.type.includes('pdf') ? '📄' : '📎'}
                      </div>
                    )}
                    <p className="truncate px-1.5 py-1 text-[10px] text-slate-400">{f.name}</p>
                    <button
                      type="button"
                      onClick={() => removerArquivo(idx)}
                      title="Remover"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white shadow"
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onFechar}
            className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm font-medium hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando}
            className="flex-1 rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
