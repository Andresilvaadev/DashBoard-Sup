import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import type { ItemKit, Kit, Pedido, Prioridade, StatusPedido, TipoPedido } from '../types'
import { ITENS_KIT, ehKit, totalKit } from '../lib/kit'
import { enviarAnexo } from '../lib/anexos'
import { comprimirImagem } from '../utils/imagem'

function gerarCodigo(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** Modal de criação/edição de pedido (apenas admin), com anexo de imagens/arquivos. */
export default function PedidoFormModal({
  pedido,
  tipoNovo = 'pronto',
  onFechar,
  onSalvo,
}: {
  pedido?: Pedido | null
  /** tipo usado ao CRIAR (a aba de origem define: Pedidos ou Criação) */
  tipoNovo?: TipoPedido
  onFechar: () => void
  onSalvo: () => void
}) {
  const toast = useToast()
  const editando = Boolean(pedido)
  // Ao criar, o número vem da sequência do banco (600, 601, 602…). Aqui só
  // mostramos a prévia; o número definitivo é atribuído no momento de salvar,
  // para dois cadastros simultâneos nunca receberem o mesmo.
  const [numero, setNumero] = useState(pedido ? pedido.numero.toString() : '')
  const [cliente, setCliente] = useState(pedido?.cliente ?? '')
  // Código de acesso: o cliente usa este código para consultar o pedido no Portal
  const [codigoAcesso, setCodigoAcesso] = useState(pedido?.cpf ?? gerarCodigo())
  const [descricao, setDescricao] = useState(pedido?.descricao ?? '')
  const [quantidade, setQuantidade] = useState(pedido?.quantidade?.toString() ?? '1')
  // Categoria do pedido: um kit junta itens variados (camisa, caneca,
  // tirante…), cada um com a sua quantidade, no lugar de uma quantidade só.
  const [categoria, setCategoria] = useState<'uniforme' | 'kit'>(
    ehKit(pedido?.kit) ? 'kit' : 'uniforme',
  )
  // A quantidade fica como texto para o campo poder ficar vazio enquanto a
  // pessoa digita; a chave existir = item marcado.
  const [kitForm, setKitForm] = useState<Partial<Record<ItemKit, string>>>(() => {
    const inicial: Partial<Record<ItemKit, string>> = {}
    for (const { id } of ITENS_KIT) {
      const qtd = pedido?.kit?.[id]
      if (qtd && qtd > 0) inicial[id] = String(qtd)
    }
    return inicial
  })
  const [prioridade, setPrioridade] = useState<Prioridade>(pedido?.prioridade ?? 'normal')
  // aba do pedido: ao editar mantém a atual; ao criar, herda a aba de origem
  const tipo: TipoPedido = pedido?.tipo ?? tipoNovo
  const [status, setStatus] = useState<StatusPedido>(pedido?.status ?? 'em_andamento')
  const [dataPrevista, setDataPrevista] = useState(pedido?.data_prevista ?? '')
  const [arquivos, setArquivos] = useState<File[]>([])
  const [salvando, setSalvando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // prévia do próximo número da sequência (só ao criar)
  useEffect(() => {
    if (editando) return
    let ativo = true
    supabase.rpc('previa_numero_pedido').then(({ data }) => {
      if (ativo && typeof data === 'number') setNumero(String(data))
    })
    return () => {
      ativo = false
    }
  }, [editando])

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

  /** Marca/desmarca um item do kit. Marcar abre o campo de quantidade ao lado. */
  const alternarItemKit = (id: ItemKit) => {
    setKitForm((atual) => {
      const novo = { ...atual }
      if (id in novo) delete novo[id]
      else novo[id] = ''
      return novo
    })
  }

  /** Estado do formulário → o objeto que vai para o banco, só com o que tem quantidade */
  const montarKit = (): Kit => {
    const kit: Kit = {}
    for (const { id } of ITENS_KIT) {
      const qtd = parseInt(kitForm[id] ?? '', 10)
      if (qtd > 0) kit[id] = qtd
    }
    return kit
  }

  const kitAtual = montarKit()
  const totalPecasKit = totalKit(kitAtual)

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
    for (const original of arquivos) {
      // comprime imagens antes de subir (economiza armazenamento e banda)
      const file = await comprimirImagem(original)
      let path: string
      try {
        path = await enviarAnexo(file, numeroPedido)
      } catch (e) {
        falhas++
        detalhe = e instanceof Error ? e.message : 'falha no upload'
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

    // No kit, a quantidade do pedido é a soma dos itens — não faz sentido
    // um kit sem nenhum item marcado.
    const kit = categoria === 'kit' ? kitAtual : {}
    if (categoria === 'kit' && totalKit(kit) === 0) {
      toast('Marque ao menos um item do kit e informe a quantidade.', 'erro')
      return
    }
    const qtdFinal =
      categoria === 'kit' ? totalKit(kit) : parseInt(quantidade, 10) || 1

    setSalvando(true)
    const num = parseInt(numero, 10)
    let error
    let pedidoId = pedido?.id ?? null
    // número definitivo: ao criar, quem decide é o banco (sequência)
    let numeroFinal = num

    if (editando && pedido) {
      ;({ error } = await supabase
        .from('pedidos')
        .update({
          numero: num,
          cliente,
          cpf: codigoAcesso || null,
          descricao,
          quantidade: qtdFinal,
          kit,
          prioridade,
          tipo,
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
        // null = o banco atribui o próximo da sequência, de forma atômica
        p_numero: null,
        p_cliente: cliente,
        p_descricao: descricao,
        p_quantidade: qtdFinal,
        p_prioridade: prioridade,
        p_data_prevista: dataPrevista || null,
        p_tipo: tipo,
        p_cpf: codigoAcesso || null,
        p_kit: kit,
      })
      error = res.error
      pedidoId = typeof res.data === 'string' && res.data ? res.data : null
      // descobre o número que o banco atribuiu (a prévia pode ter mudado)
      if (!error && pedidoId) {
        const { data: criado } = await supabase
          .from('pedidos')
          .select('numero')
          .eq('id', pedidoId)
          .maybeSingle()
        if (typeof criado?.numero === 'number') numeroFinal = criado.numero
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

    if (pedidoId) await enviarAnexos(pedidoId, numeroFinal)
    else if (arquivos.length > 0)
      toast('Pedido salvo, mas os anexos não puderam ser enviados. Anexe-os pela tela do pedido.', 'erro')

    setSalvando(false)
    toast(editando ? 'Pedido atualizado.' : `Pedido ${numeroFinal} criado.`, 'sucesso')
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

        {/* Categoria: pedido comum (uniformes/camisas) ou kit, que junta
            itens variados com uma quantidade cada. Só na criação — trocar a
            categoria de um pedido já em produção mudaria no meio do caminho
            o que a fábrica está fazendo. */}
        {!editando && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(
              [
                ['uniforme', 'Uniformes / Camisas'],
                ['kit', 'Kit'],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setCategoria(valor)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                  categoria === valor
                    ? 'border-red-500 bg-red-600/15 text-red-300'
                    : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        )}

        <div className={`mt-4 gap-3 ${categoria === 'kit' ? '' : 'grid grid-cols-2'}`}>
          <div>
            <label className="text-xs font-medium text-slate-400">
              Nº OS{editando ? ' *' : ''}
            </label>
            {editando ? (
              <input
                type="number"
                required
                min={1}
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                className={inputCls}
              />
            ) : (
              <div
                title="Numeração automática e sequencial"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-300"
              >
                {numero || <span className="text-slate-600">gerando…</span>}
              </div>
            )}
          </div>
          {/* No kit a quantidade sai da soma dos itens, então o campo solto some */}
          {categoria !== 'kit' && (
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
          )}
        </div>

        {/* Itens do kit: marcar abre o campo de quantidade ao lado */}
        {categoria === 'kit' && (
          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/60 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <label className="text-xs font-medium text-slate-400">Itens do kit *</label>
              <span className="text-xs text-slate-500">
                {totalPecasKit > 0 ? `${totalPecasKit} peças no total` : 'nenhum item marcado'}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {ITENS_KIT.map(({ id, rotulo }) => {
                const marcado = id in kitForm
                return (
                  <div key={id} className="flex items-center gap-2">
                    <label className="flex flex-1 cursor-pointer select-none items-center gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternarItemKit(id)}
                        className="h-4 w-4 accent-red-500"
                      />
                      {rotulo}
                    </label>
                    {marcado && (
                      <input
                        type="number"
                        required
                        min={1}
                        value={kitForm[id] ?? ''}
                        onChange={(e) => setKitForm((atual) => ({ ...atual, [id]: e.target.value }))}
                        placeholder="Qtd"
                        aria-label={`Quantidade de ${rotulo.toLowerCase()}`}
                        className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-right text-sm outline-none focus:border-red-500"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-3">
          <label className="text-xs font-medium text-slate-400">Cliente *</label>
          <input required value={cliente} onChange={(e) => setCliente(e.target.value)} className={inputCls} />
        </div>

        <div className="mt-3">
          <label className="text-xs font-medium text-slate-400">Código de acesso ao Portal</label>
          <div className="mt-1 flex gap-2">
            <input
              value={codigoAcesso}
              onChange={(e) => setCodigoAcesso(e.target.value.toUpperCase())}
              placeholder="Ex.: A3F7K2M9"
              className={`${inputCls} flex-1 font-mono tracking-widest`}
            />
            {!editando && (
              <button
                type="button"
                title="Gerar novo código"
                onClick={() => setCodigoAcesso(gerarCodigo())}
                className="mt-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-400 hover:border-red-500 hover:text-red-400"
              >
                ↺
              </button>
            )}
            <button
              type="button"
              title="Copiar código"
              onClick={() => void navigator.clipboard.writeText(codigoAcesso)}
              className="mt-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-400 hover:border-red-500 hover:text-red-400"
            >
              ⎘
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Compartilhe este código com o cliente para que ele consulte o pedido no Portal.
          </p>
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
            <p className="mt-1 text-xs text-slate-500">
              Para mover este pedido para outra aba, use "Mover para outra aba" na tela do pedido.
            </p>
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Adicionar imagem ou arquivo
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
                      <div className="flex h-20 w-full items-center justify-center">
                        <span className="rounded border border-slate-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {f.type.includes('pdf') ? 'PDF' : 'Arquivo'}
                        </span>
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
