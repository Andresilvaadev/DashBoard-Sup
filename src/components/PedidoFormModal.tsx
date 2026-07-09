import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import type { Pedido, Prioridade, StatusPedido } from '../types'
import { comprimirImagem } from '../utils/imagem'

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
  const [status, setStatus] = useState<StatusPedido>(pedido?.status ?? 'em_andamento')
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
    if (!lista || lista.length === 0) return
    // copia JÁ: o FileList é "vivo" e esvazia quando o input é limpo logo em seguida
    const novos = Array.from(lista)
    setArquivos((atual) => [...atual, ...novos])
  }

  const removerArquivo = (idx: number) => {
    setArquivos((atual) => atual.filter((_, i) => i !== idx))
  }

  /** Envia os arquivos selecionados para o Storage e registra na tabela anexos */
  const enviarAnexos = async (pedidoId: string, numeroPedido: number) => {
    if (arquivos.length === 0) return true
    const { data: userData } = await supabase.auth.getUser()
    let falhas = 0
    let detalhe = ''
    for (const [i, original] of arquivos.entries()) {
      // comprime imagens antes de subir (economiza armazenamento e banda)
      const file = await comprimirImagem(original)
      // índice no nome evita colisão quando vários arquivos sobem no mesmo milissegundo
      const path = `${numeroPedido}/${Date.now()}-${i}-${file.name.replace(/[^\w.\-]/g, '_')}`
      const { error: upErr } = await supabase.storage.from('anexos').upload(path, file)
      if (upErr) {
        falhas++
        detalhe = upErr.message
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
      if (error) {
        falhas++
        detalhe = error.message
      }
    }
    if (falhas > 0) toast(`${falhas} arquivo(s) não puderam ser anexados: ${detalhe}`, 'erro')
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
          status,
          // cada status ganha sua própria data ao ser aplicado; sair do status limpa
          concluido_em:
            status === 'concluido' ? (pedido.concluido_em ?? new Date().toISOString()) : null,
          cancelado_em:
            status === 'cancelado' ? (pedido.cancelado_em ?? new Date().toISOString()) : null,
          arquivado_em:
            status === 'arquivado' ? (pedido.arquivado_em ?? new Date().toISOString()) : null,
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
      pedidoId = typeof res.data === 'string' && res.data ? res.data : null
      // fallback: se a função do banco não devolver o id, busca pelo número
      if (!error && !pedidoId) {
        const { data: criado } = await supabase
          .from('pedidos')
          .select('id')
          .eq('numero', num)
          .maybeSingle()
        pedidoId = (criado?.id as string | undefined) ?? null
      }
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
    else if (arquivos.length > 0)
      toast('Pedido salvo, mas os anexos não puderam ser enviados. Anexe-os pela tela do pedido.', 'erro')

    setSalvando(false)
    toast(editando ? 'Pedido atualizado.' : `Pedido ${numero} criado.`, 'sucesso')
    onSalvo()
    onFechar()
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500'

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

        {editando && (
          <div className="mt-3">
            <label className="text-xs font-medium text-slate-400">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusPedido)}
              className={inputCls}
            >
              <option value="em_andamento">Em andamento</option>
              <option value="concluido">Concluído</option>
              <option value="arquivado">Arquivado (sem concluir)</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </div>
        )}

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
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-600 py-3 text-sm text-slate-400 transition-colors hover:border-red-500 hover:text-red-400"
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
            className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
