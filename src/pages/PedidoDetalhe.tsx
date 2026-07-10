import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useEtapas } from '../hooks/useEtapas'
import { usePedidos } from '../hooks/usePedidos'
import { supabase } from '../lib/supabase'
import type { Anexo, Historico, Pedido, StatusPedido } from '../types'
import { enviarAnexo, urlAnexo, urlsAnexos } from '../lib/anexos'
import { pedidosQuePassaramNaFrente } from '../utils/fila'
import { comprimirImagem } from '../utils/imagem'
import { removerAnexosStorage } from '../utils/storage'
import { formatarData, formatarDataHora, formatarDuracao, segundosDesde } from '../utils/tempo'

export default function PedidoDetalhe() {
  const { numero } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { isAdmin } = useAuth()
  const { etapas, etapasAtivas } = useEtapas()
  const { pedidos: todosPedidos } = usePedidos()
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [historico, setHistorico] = useState<Historico[]>([])
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [movendo, setMovendo] = useState(false)
  const [enviandoArquivo, setEnviandoArquivo] = useState(false)
  // URLs assinadas para exibir as fotos direto na lista (bucket é privado)
  const [urlsImagens, setUrlsImagens] = useState<Record<string, string>>({})
  const [imagemAberta, setImagemAberta] = useState<{ url: string; nome: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const carregar = async () => {
    const { data: p } = await supabase
      .from('pedidos')
      .select('*, etapa_atual:etapas(*)')
      .eq('numero', Number(numero))
      .maybeSingle()
    setPedido(p as Pedido | null)
    if (p) {
      const [h, a] = await Promise.all([
        supabase
          .from('historico')
          .select('*, etapa:etapas(*), funcionario:profiles(id, nome)')
          .eq('pedido_id', p.id)
          .order('entrada', { ascending: false }),
        supabase
          .from('anexos')
          .select('*, uploader:profiles(id, nome)')
          .eq('pedido_id', p.id)
          .order('created_at', { ascending: false }),
      ])
      setHistorico((h.data as Historico[]) ?? [])
      const listaAnexos = (a.data as Anexo[]) ?? []
      setAnexos(listaAnexos)

      // miniaturas das imagens (Cloudinary ou URL assinada do Storage)
      const pathsImagens = listaAnexos.filter((x) => x.tipo.startsWith('image/')).map((x) => x.path)
      setUrlsImagens(pathsImagens.length > 0 ? await urlsAnexos(pathsImagens, { miniatura: true }) : {})
    }
    setCarregando(false)
  }

  useEffect(() => {
    carregar()
    const canal = supabase
      .channel(`pedido-${numero}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'historico' }, carregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, carregar)
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numero])

  const mover = async (etapaId: string) => {
    if (!pedido) return
    setMovendo(true)
    const { error } = await supabase.rpc('mover_pedido', {
      p_numero: pedido.numero,
      p_etapa_id: etapaId,
      p_observacao: '',
      p_via_voz: false,
    })
    setMovendo(false)
    if (error) toast(error.message, 'erro')
    else toast('Etapa atualizada.', 'sucesso')
  }

  const enviarArquivo = async (original: File) => {
    if (!pedido) return
    setEnviandoArquivo(true)
    // comprime imagens antes de subir (economiza armazenamento e banda)
    const file = await comprimirImagem(original)
    let path: string
    try {
      path = await enviarAnexo(file, pedido.numero)
    } catch (e) {
      setEnviandoArquivo(false)
      toast(`Falha no upload: ${e instanceof Error ? e.message : ''}`, 'erro')
      return
    }
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('anexos').insert({
      pedido_id: pedido.id,
      nome: file.name,
      path,
      tipo: file.type,
      tamanho: file.size,
      uploaded_by: userData.user?.id,
    })
    setEnviandoArquivo(false)
    if (error) toast(error.message, 'erro')
    else {
      toast('Arquivo anexado.', 'sucesso')
      carregar()
    }
  }

  const alterarStatus = async (status: StatusPedido) => {
    if (!pedido) return
    const agora = new Date().toISOString()
    const confirmacoes: Record<StatusPedido, string> = {
      arquivado: `Arquivar o pedido ${pedido.numero}? Ele sai do fluxo e vai para o Arquivo SEM ser marcado como concluído. Você pode reativá-lo depois.`,
      concluido: `Marcar o pedido ${pedido.numero} como concluído? Ele será registrado como entregue e movido para o Arquivo.`,
      cancelado: `Cancelar o pedido ${pedido.numero}? Ele sai do fluxo, mas o histórico é mantido e você pode reativá-lo depois.`,
      em_andamento: `Reativar o pedido ${pedido.numero}? Ele volta para o fluxo de produção.`,
    }
    const sucessos: Record<StatusPedido, string> = {
      arquivado: 'Pedido arquivado.',
      concluido: 'Pedido concluído.',
      cancelado: 'Pedido cancelado.',
      em_andamento: 'Pedido reativado.',
    }
    if (!confirm(confirmacoes[status])) return
    const { error } = await supabase
      .from('pedidos')
      .update({
        status,
        // cada status grava sua própria data; sair do status limpa
        concluido_em: status === 'concluido' ? (pedido.concluido_em ?? agora) : null,
        cancelado_em: status === 'cancelado' ? agora : null,
        arquivado_em: status === 'arquivado' ? agora : null,
      })
      .eq('id', pedido.id)
    if (error) toast(error.message, 'erro')
    else {
      toast(sucessos[status], 'sucesso')
      carregar()
    }
  }

  const excluirPedido = async () => {
    if (!pedido) return
    if (
      !confirm(
        `Excluir DEFINITIVAMENTE o pedido ${pedido.numero} (${pedido.cliente})? O histórico e os anexos dele também serão apagados. Essa ação não pode ser desfeita.`,
      )
    )
      return
    const { data, error } = await supabase.rpc('excluir_pedido', { p_numero: pedido.numero })
    if (error) {
      toast(error.message, 'erro')
      return
    }
    await removerAnexosStorage((data as string[]) ?? [])
    toast(`Pedido ${pedido.numero} excluído.`, 'sucesso')
    navigate('/pedidos')
  }

  const baixarAnexo = async (a: Anexo) => {
    const url = await urlAnexo(a.path)
    if (!url) {
      toast('Não foi possível abrir o arquivo.', 'erro')
      return
    }
    window.open(url, '_blank')
  }

  if (carregando) {
    return (
      <div className="flex justify-center py-20">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
      </div>
    )
  }

  if (!pedido) {
    return (
      <div className="py-20 text-center">
        <p className="text-slate-400">Pedido {numero} não encontrado.</p>
        <Link to="/pedidos" className="mt-2 inline-block text-sm text-red-400 hover:underline">
          ← Voltar aos pedidos
        </Link>
      </div>
    )
  }

  const etapaAbertaDesde = historico.find((h) => !h.saida)?.entrada

  // pedidos criados depois deste que já estão numa etapa à frente (ou concluídos)
  const passaramNaFrente = pedidosQuePassaramNaFrente(pedido, todosPedidos, etapas)

  // tempo somado em cada etapa (entradas fechadas + tempo corrente da etapa aberta)
  const tempoPorEtapa = etapas
    .map((e) => {
      let segundos = 0
      let emAndamento = false
      for (const h of historico) {
        if (h.etapa_id !== e.id) continue
        if (h.saida) {
          segundos +=
            h.segundos_gastos ??
            (new Date(h.saida).getTime() - new Date(h.entrada).getTime()) / 1000
        } else {
          segundos += segundosDesde(h.entrada)
          emAndamento = true
        }
      }
      return { etapa: e, segundos, emAndamento }
    })
    .filter((t) => t.segundos > 0 || t.emAndamento)
  const totalSegundos = tempoPorEtapa.reduce((soma, t) => soma + t.segundos, 0)

  return (
    <div className="space-y-6">
      <div>
        <Link to="/pedidos" className="text-sm text-slate-400 hover:text-red-400">
          ← Pedidos
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">Pedido #{pedido.numero}</h1>
          {pedido.status === 'concluido' ? (
            <span className="rounded-full bg-emerald-900 px-3 py-1 text-xs font-medium text-emerald-300">
              ✓ Concluído
            </span>
          ) : pedido.status === 'arquivado' ? (
            <span className="rounded-full bg-violet-900 px-3 py-1 text-xs font-medium text-violet-300">
              📥 Arquivado
            </span>
          ) : pedido.status === 'cancelado' ? (
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-400">
              Cancelado
            </span>
          ) : (
            <span
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{
                background: `${pedido.etapa_atual?.cor ?? '#ec1c24'}22`,
                color: pedido.etapa_atual?.cor ?? '#ec1c24',
              }}
            >
              {pedido.etapa_atual?.nome}
              {etapaAbertaDesde && ` • há ${formatarDuracao(segundosDesde(etapaAbertaDesde))}`}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-400">
          {pedido.cliente} • {pedido.quantidade} un. • prioridade {pedido.prioridade}
          {pedido.data_prevista && ` • entrega ${formatarData(pedido.data_prevista)}`}
        </p>
        {pedido.descricao && <p className="mt-1 text-sm text-slate-500">{pedido.descricao}</p>}

        {/* Ações de admin: arquivar / cancelar / reativar / excluir */}
        {isAdmin && (
          <div className="mt-3 flex flex-wrap gap-2">
            {pedido.status === 'em_andamento' && (
              <>
                <button
                  onClick={() => void alterarStatus('concluido')}
                  className="rounded-lg border border-emerald-800 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-950"
                >
                  ✓ Concluir pedido
                </button>
                <button
                  onClick={() => void alterarStatus('arquivado')}
                  className="rounded-lg border border-violet-800 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-950"
                >
                  📥 Arquivar sem concluir
                </button>
                <button
                  onClick={() => void alterarStatus('cancelado')}
                  className="rounded-lg border border-amber-800 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-950"
                >
                  ⊘ Cancelar pedido
                </button>
              </>
            )}
            {pedido.status !== 'em_andamento' && (
              <button
                onClick={() => void alterarStatus('em_andamento')}
                className="rounded-lg border border-emerald-800 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-950"
              >
                ↻ Reativar pedido
              </button>
            )}
            <button
              onClick={() => void excluirPedido()}
              className="rounded-lg border border-rose-900 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-950"
            >
              🗑 Excluir definitivamente
            </button>
          </div>
        )}
      </div>

      {/* Pedidos mais novos que passaram na frente deste */}
      {pedido.status === 'em_andamento' && passaramNaFrente.length > 0 && (
        <div className="rounded-xl border border-amber-900 bg-amber-950/40 p-4">
          <p className="text-sm font-semibold text-amber-300">
            ⏫{' '}
            {passaramNaFrente.length > 1
              ? `${passaramNaFrente.length} pedidos criados depois deste já passaram na frente`
              : '1 pedido criado depois deste já passou na frente'}
          </p>
          <p className="mt-1 text-xs text-amber-200/70">
            Criados após {formatarDataHora(pedido.created_at)} e já em etapa à frente de "
            {pedido.etapa_atual?.nome}" (ou concluídos):
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {passaramNaFrente.map((o) => (
              <Link
                key={o.id}
                to={`/pedidos/${o.numero}`}
                className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-red-400 hover:underline"
              >
                #{o.numero} · {o.status === 'concluido' ? 'Concluído' : o.etapa_atual?.nome ?? '—'}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Mover etapa (pedido cancelado/arquivado não se move; reative antes) */}
      {pedido.status !== 'cancelado' && pedido.status !== 'arquivado' && (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold">Mover para etapa</h2>
        <div className="flex flex-wrap gap-2">
          {etapasAtivas.map((e) => {
            const atual = e.id === pedido.etapa_atual_id
            return (
              <button
                key={e.id}
                disabled={atual || movendo}
                onClick={() => void mover(e.id)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                  atual
                    ? 'border-transparent text-slate-950'
                    : 'border-slate-700 text-slate-300 hover:border-slate-500 disabled:opacity-40'
                }`}
                style={atual ? { background: e.cor } : undefined}
              >
                {e.ordem}. {e.nome}
              </button>
            )
          })}
        </div>
      </div>
      )}

      {/* Tempo somado em cada etapa */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold">Tempo em cada etapa</h2>
        {tempoPorEtapa.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">Sem registros ainda.</p>
        ) : (
          <div className="space-y-2">
            {tempoPorEtapa.map(({ etapa, segundos, emAndamento }) => (
              <div key={etapa.id} className="flex items-center gap-3 text-sm">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: etapa.cor }}
                />
                <span className="w-32 truncate sm:w-40">{etapa.nome}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${totalSegundos > 0 ? Math.max(2, (segundos / totalSegundos) * 100) : 0}%`,
                      background: etapa.cor,
                    }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs text-slate-400">
                  {formatarDuracao(segundos)}
                  {emAndamento && ' ⏳'}
                </span>
              </div>
            ))}
            <p className="border-t border-slate-800 pt-2 text-right text-xs text-slate-500">
              Total: <span className="font-semibold text-slate-300">{formatarDuracao(totalSegundos)}</span>
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Histórico */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">Histórico completo</h2>
          <ol className="relative space-y-4 border-l border-slate-800 pl-5">
            {historico.map((h) => (
              <li key={h.id} className="relative">
                <span
                  className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-slate-900"
                  style={{ background: h.etapa?.cor ?? '#ec1c24' }}
                />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold">{h.etapa?.nome}</span>
                  {h.via_voz && <span title="Via comando de voz">🎙️</span>}
                  <span className="text-xs text-slate-500">
                    {h.saida ? formatarDuracao(h.segundos_gastos) : `em andamento (${formatarDuracao(segundosDesde(h.entrada))})`}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {h.funcionario?.nome ?? 'Sistema'} • entrada {formatarDataHora(h.entrada)}
                  {h.saida && ` • saída ${formatarDataHora(h.saida)}`}
                </p>
                {h.observacao && <p className="mt-0.5 text-xs italic text-slate-500">{h.observacao}</p>}
              </li>
            ))}
          </ol>
        </div>

        {/* Anexos */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Anexos ({anexos.length})</h2>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={enviandoArquivo}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700 disabled:opacity-50"
            >
              {enviandoArquivo ? 'Enviando…' : '+ Anexar arquivo'}
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/*,.pdf,.ai,.psd,.cdr,.doc,.docx,.xls,.xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void enviarArquivo(f)
                e.target.value = ''
              }}
            />
          </div>
          {anexos.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Nenhum arquivo. Anexe fotos, PDFs, artes ou fichas técnicas.
            </p>
          ) : (
            <>
              {/* Fotos: miniaturas visíveis direto na lista */}
              {anexos.some((a) => urlsImagens[a.path]) && (
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {anexos
                    .filter((a) => urlsImagens[a.path])
                    .map((a) => (
                      <button
                        key={a.id}
                        onClick={() => setImagemAberta({ url: urlsImagens[a.path], nome: a.nome })}
                        title={a.nome}
                        className="group relative overflow-hidden rounded-lg border border-slate-800 hover:border-red-500"
                      >
                        <img
                          src={urlsImagens[a.path]}
                          alt={a.nome}
                          loading="lazy"
                          className="h-28 w-full object-cover transition-transform group-hover:scale-105"
                        />
                        <span className="absolute inset-x-0 bottom-0 truncate bg-slate-950/80 px-2 py-1 text-left text-[10px] text-slate-300">
                          {a.nome}
                        </span>
                      </button>
                    ))}
                </div>
              )}

              {/* Demais arquivos (PDFs, artes, documentos) */}
              <ul className="space-y-2">
                {anexos
                  .filter((a) => !urlsImagens[a.path])
                  .map((a) => (
                    <li key={a.id}>
                      <button
                        onClick={() => void baixarAnexo(a)}
                        className="flex w-full items-center gap-3 rounded-lg border border-slate-800 p-2.5 text-left hover:border-slate-600"
                      >
                        <span className="text-xl">
                          {a.tipo.startsWith('image/') ? '🖼️' : a.tipo.includes('pdf') ? '📄' : '📎'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{a.nome}</span>
                          <span className="block text-xs text-slate-500">
                            {(a.tamanho / 1024).toFixed(0)} KB • {a.uploader?.nome ?? ''} •{' '}
                            {formatarDataHora(a.created_at)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Visualizador de foto em tela cheia */}
      {imagemAberta && (
        <div
          className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-black/90 p-4"
          onClick={() => setImagemAberta(null)}
        >
          <img
            src={imagemAberta.url}
            alt={imagemAberta.nome}
            className="max-h-[85dvh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="mt-3 flex items-center gap-4">
            <p className="max-w-[60vw] truncate text-sm text-slate-300">{imagemAberta.nome}</p>
            <a
              href={imagemAberta.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-slate-700"
            >
              Abrir original
            </a>
            <button
              onClick={() => setImagemAberta(null)}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700"
            >
              Fechar ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
