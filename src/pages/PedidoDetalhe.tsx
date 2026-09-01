import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import FichasTecnicas from '../components/FichasTecnicas'
import { useAbaAtiva } from '../contexts/AbaAtivaContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { useEtapas } from '../hooks/useEtapas'
import { usePedidos } from '../hooks/usePedidos'
import { supabase } from '../lib/supabase'
import type { Anexo, Historico, Pedido, StatusPedido } from '../types'
import { ABAS, abaDoTipo, fluxoDoTipo, rotulosConclusao, type Aba } from '../lib/abas'
import { enviarAnexo, urlAnexo, urlsAnexos } from '../lib/anexos'
import { pedidosQuePassaramNaFrente } from '../utils/fila'
import { comprimirImagem } from '../utils/imagem'
import { ehKit, itensDoKit, totalKit } from '../lib/kit'
import { removerAnexosStorage } from '../utils/storage'
import { formatarData, formatarDataHora, formatarDuracao, segundosDesde } from '../utils/tempo'

export default function PedidoDetalhe() {
  const { numero } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const confirmar = useConfirm()
  // admin OU gestor gerenciam o pedido (status, aba, exclusão)
  const { podeGerenciarPedidos: podeGerenciar } = useAuth()
  const { setAba } = useAbaAtiva()
  const { etapas, etapasDoFluxo } = useEtapas()
  const { pedidos: todosPedidos } = usePedidos()
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [historico, setHistorico] = useState<Historico[]>([])
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [movendo, setMovendo] = useState(false)
  const [enviandoArquivo, setEnviandoArquivo] = useState(false)
  /** id do anexo sendo apagado no momento */
  const [apagandoAnexo, setApagandoAnexo] = useState<string | null>(null)
  // URLs assinadas para exibir as fotos direto na lista (bucket é privado)
  const [urlsImagens, setUrlsImagens] = useState<Record<string, string>>({})
  const [imagemAberta, setImagemAberta] = useState<{ url: string; nome: string; path: string } | null>(null)
  /** path da foto sendo baixada no momento */
  const [baixandoFoto, setBaixandoFoto] = useState<string | null>(null)
  const [descricaoVisivel, setDescricaoVisivel] = useState(true)
  // ocorrências: escritas aqui, porque o problema aparece durante a produção
  const [ocorrenciaVisivel, setOcorrenciaVisivel] = useState(true)
  const [editandoOcorrencia, setEditandoOcorrencia] = useState(false)
  const [textoOcorrencia, setTextoOcorrencia] = useState('')
  const [salvandoOcorrencia, setSalvandoOcorrencia] = useState(false)
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

  // mantém aceso no menu o item da aba do pedido (Criação/Canecas em vez de
  // Pedidos, já que o detalhe mora em /pedidos/:numero para todas as abas)
  useEffect(() => {
    if (pedido) setAba(abaDoTipo(pedido.tipo).rota)
  }, [pedido, setAba])
  useEffect(() => () => setAba(null), [setAba])

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

  /** Move o pedido para outra aba, colocando-o na 1ª etapa do fluxo de destino */
  const moverParaAba = async (destino: Aba) => {
    if (!pedido) return
    const primeira = etapasDoFluxo(destino.fluxo)[0]
    if (!primeira) {
      toast(`A aba "${destino.label}" ainda não tem etapas configuradas.`, 'erro')
      return
    }
    if (
      !(await confirmar({
        titulo: `Mover para ${destino.label}`,
        mensagem: `O pedido ${pedido.numero} vai recomeçar na etapa "${primeira.nome}".`,
        textoConfirmar: 'Mover',
      }))
    )
      return
    setMovendo(true)
    // RPC em vez de update na tabela: o funcionário também move de aba,
    // sem ganhar permissão de editar o resto do pedido
    const { error } = await supabase.rpc('mover_pedido_aba', {
      p_numero: pedido.numero,
      p_tipo: destino.tipo,
    })
    setMovendo(false)
    if (error) toast(error.message, 'erro')
    else {
      toast(`Pedido movido para ${destino.label}.`, 'sucesso')
      carregar()
    }
  }

  /**
   * Flag interno da aba Criação: sinaliza que a arte está pronta para ir ao cliente.
   * Vai por RPC, e não por update na tabela: assim qualquer funcionário marca a
   * arte sem ganhar permissão de editar o resto do pedido.
   */
  const marcarArte = async () => {
    if (!pedido) return
    const { error } = await supabase.rpc('marcar_arte', {
      p_pedido_id: pedido.id,
      p_concluida: !pedido.arte_concluida,
    })
    if (error) toast(error.message, 'erro')
    else carregar()
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
    const titulos: Record<StatusPedido, string> = {
      arquivado: 'Arquivar pedido',
      concluido: 'Concluir pedido',
      cancelado: 'Cancelar pedido',
      em_andamento: 'Reativar pedido',
    }
    if (
      !(await confirmar({
        titulo: titulos[status],
        mensagem: confirmacoes[status],
        textoConfirmar: titulos[status].split(' ')[0],
        perigo: status === 'cancelado',
      }))
    )
      return
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
      !(await confirmar({
        titulo: `Excluir pedido ${pedido.numero}`,
        mensagem: `O histórico e os anexos de ${pedido.cliente} também serão apagados. Essa ação não pode ser desfeita.`,
        textoConfirmar: 'Excluir tudo',
        perigo: true,
      }))
    )
      return
    const { data, error } = await supabase.rpc('excluir_pedido', { p_numero: pedido.numero })
    if (error) {
      toast(error.message, 'erro')
      return
    }
    await removerAnexosStorage((data as string[]) ?? [])
    toast(`Pedido ${pedido.numero} excluído.`, 'sucesso')
    navigate(abaDoTipo(pedido.tipo).rota)
  }

  /** Apaga um anexo: remove o registro e o arquivo do Storage. */
  const excluirAnexo = async (a: Anexo) => {
    if (
      !(await confirmar({
        titulo: 'Apagar anexo',
        mensagem: `Apagar "${a.nome}"? Esta ação não pode ser desfeita.`,
        textoConfirmar: 'Apagar',
        perigo: true,
      }))
    )
      return
    setApagandoAnexo(a.id)
    const { error } = await supabase.from('anexos').delete().eq('id', a.id)
    if (error) {
      setApagandoAnexo(null)
      toast(
        error.message.includes('row-level security')
          ? 'Você não tem permissão para apagar anexos.'
          : error.message,
        'erro',
      )
      return
    }
    await removerAnexosStorage([a.path])
    setApagandoAnexo(null)
    // se a foto apagada estava aberta em tela cheia, fecha o visualizador
    setImagemAberta((atual) => (atual?.path === a.path ? null : atual))
    toast(`"${a.nome}" apagado.`, 'sucesso')
    carregar()
  }

  /**
   * Abre a foto em tela cheia. Mostra a miniatura na hora (já está em cache)
   * e troca pela imagem em tamanho real assim que a URL é resolvida — antes
   * a tela cheia ficava exibindo a miniatura, e por isso saía borrada.
   */
  const abrirImagem = async (a: Anexo) => {
    setImagemAberta({ url: urlsImagens[a.path], nome: a.nome, path: a.path })
    const cheia = await urlAnexo(a.path)
    if (!cheia) return
    setImagemAberta((atual) => (atual?.path === a.path ? { ...atual, url: cheia } : atual))
  }

  /**
   * Grava a ocorrência do pedido (aviso de problema na produção).
   * Passa pela função registrar_ocorrencia porque quem enxerga o problema é
   * quem está na produção — qualquer funcionário registra, e a função mexe
   * só nesse campo, sem abrir o resto do pedido para edição.
   */
  const salvarOcorrencia = async () => {
    if (!pedido) return
    setSalvandoOcorrencia(true)
    const { error } = await supabase.rpc('registrar_ocorrencia', {
      p_pedido_id: pedido.id,
      p_texto: textoOcorrencia.trim(),
    })
    setSalvandoOcorrencia(false)
    if (error) {
      toast(error.message, 'erro')
      return
    }
    setEditandoOcorrencia(false)
    toast(textoOcorrencia.trim() ? 'Ocorrência registrada.' : 'Ocorrência removida.', 'sucesso')
    carregar()
  }

  /** Baixa a foto no arquivo original (sem a redução aplicada na miniatura). */
  const baixarFoto = async (path: string, nome: string) => {
    setBaixandoFoto(path)
    try {
      const url = await urlAnexo(path)
      const res = await fetch(url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = nome
      link.click()
      URL.revokeObjectURL(blobUrl)
    } catch {
      toast('Falha ao baixar a foto.', 'erro')
    } finally {
      setBaixandoFoto(null)
    }
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
        {/* volta para a aba do próprio pedido (Pedidos / Criação / Canecas) */}
        <Link to={abaDoTipo(pedido.tipo).rota} className="text-sm text-slate-400 hover:text-red-400">
          ← {abaDoTipo(pedido.tipo).label}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">Pedido #{pedido.numero}</h1>
          {(pedido.tipo ?? 'pronto') !== 'pronto' && (
            <span className="rounded-full bg-fuchsia-900 px-3 py-1 text-xs font-medium text-fuchsia-300">
              ◆ {abaDoTipo(pedido.tipo).label}
            </span>
          )}
          {pedido.status === 'concluido' ? (
            <span className="rounded-full bg-emerald-900 px-3 py-1 text-xs font-medium text-emerald-300">
              ✓ Concluído
            </span>
          ) : pedido.status === 'arquivado' ? (
            <span className="rounded-full bg-violet-900 px-3 py-1 text-xs font-medium text-violet-300">
              ◆ Arquivado
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
        {/* Marcação interna de "pronto" (arte, na aba Criação; o pedido, nas demais).
            Não mexe no status do pedido nem entra em relatórios. */}
        <button
          onClick={() => void marcarArte()}
          className={`mt-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
            pedido.arte_concluida
              ? 'border-emerald-700 bg-emerald-950 text-emerald-300 hover:bg-emerald-900'
              : 'border-slate-700 text-slate-400 hover:border-emerald-700 hover:text-emerald-400'
          }`}
        >
          {pedido.arte_concluida
            ? `${rotulosConclusao(pedido.tipo).feito} — clique para desmarcar`
            : rotulosConclusao(pedido.tipo).pendente}
        </button>

        {pedido.cpf && podeGerenciar && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-slate-500">Código do portal:</span>
            <span className="font-mono text-sm font-semibold tracking-widest text-slate-200">
              {pedido.cpf}
            </span>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(pedido.cpf!)
                  .then(() => toast('Código copiado!', 'sucesso'))
              }
              className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:border-red-500 hover:text-red-400"
            >
              Copiar
            </button>
          </div>
        )}

        {/* Ações de admin: arquivar / cancelar / reativar / excluir */}
        {podeGerenciar && (
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
                  ◆ Arquivar sem concluir
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
              onClick={() => navigate(`/semana?pedido=${pedido.numero}`)}
              className="rounded-lg border border-sky-800 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-950"
            >
              Planejar na semana
            </button>
            <button
              onClick={() => void excluirPedido()}
              className="rounded-lg border border-rose-900 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-950"
            >
              ✕ Excluir definitivamente
            </button>
          </div>
        )}
      </div>

      {/* Pedidos mais novos que passaram na frente deste */}
      {pedido.status === 'em_andamento' && passaramNaFrente.length > 0 && (
        <div className="rounded-xl border border-amber-900 bg-amber-950/40 p-4">
          <p className="text-sm font-semibold text-amber-300">
            ▲{' '}
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

      {/* Mover etapa (pedido cancelado/arquivado não se move; reative antes).
          Cada aba tem seu próprio fluxo de etapas. */}
      {pedido.status !== 'cancelado' && pedido.status !== 'arquivado' && (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold">
          Mover para etapa
          <span className="ml-2 text-xs font-normal text-slate-500">
            (aba {abaDoTipo(pedido.tipo).label})
          </span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {etapasDoFluxo(fluxoDoTipo(pedido.tipo)).map((e) => {
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

        {/* Mover para outra aba (muda o fluxo e reinicia na 1ª etapa do destino).
            Liberado para todos: mover é atribuição do funcionário; o que ele
            não pode é criar ou editar o pedido. */}
        <div className="mt-4 border-t border-slate-800 pt-3">
          <p className="mb-2 text-xs font-medium text-slate-400">Mover para outra aba</p>
          <div className="flex flex-wrap gap-2">
            {ABAS.filter((a) => a.tipo !== (pedido.tipo ?? 'pronto')).map((a) => (
              <button
                key={a.tipo}
                onClick={() => void moverParaAba(a)}
                disabled={movendo}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:border-sky-600 hover:text-sky-300 disabled:opacity-40"
              >
                → {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* Descrição em destaque (o que o pedido pede) — recolhível */}
      {pedido.descricao && (
        <div className="rounded-xl border border-l-4 border-slate-800 border-l-amber-500 bg-slate-900 p-4">
          <button
            onClick={() => setDescricaoVisivel((v) => !v)}
            className="flex w-full items-center justify-between gap-2"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">Descrição</p>
            <span
              className={`text-xs text-slate-500 transition-transform duration-300 ${
                descricaoVisivel ? 'rotate-0' : '-rotate-90'
              }`}
            >
              ▼
            </span>
          </button>
          {/* grid-rows 1fr→0fr: o próprio CSS anima a altura, sem medir nada em JS */}
          <div
            className={`grid transition-all duration-300 ease-in-out ${
              descricaoVisivel ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            }`}
          >
            <div className="overflow-hidden">
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                {pedido.descricao}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Kit: os itens só existem no pedido de kit, e é a informação que
          diz o que precisa ser produzido — sem ela a quantidade total não
          conta a história. */}
      {ehKit(pedido.kit) && (
        <div className="rounded-xl border border-l-4 border-slate-800 border-l-sky-500 bg-slate-900 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-400">
              Itens do kit
            </p>
            <span className="text-xs text-slate-500">{totalKit(pedido.kit)} peças no total</span>
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {itensDoKit(pedido.kit).map((i) => (
              <li key={i.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-slate-300">{i.rotulo}</span>
                <span className="font-semibold text-slate-100">{i.quantidade}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Ocorrências: mesmo formato da Descrição, em vermelho. Escrita aqui
          mesmo, e por QUALQUER funcionário — quem enxerga a falta de peça, a
          troca ou a avaria é quem está na produção, não quem cadastra. */}
      <div className="rounded-xl border border-l-4 border-slate-800 border-l-rose-500 bg-slate-900 p-4">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setOcorrenciaVisivel((v) => !v)}
            className="flex flex-1 items-center gap-2 text-left"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-400">
              Ocorrências
            </p>
            {pedido.ocorrencias && (
              <span
                className={`text-xs text-slate-500 transition-transform duration-300 ${
                  ocorrenciaVisivel ? 'rotate-0' : '-rotate-90'
                }`}
              >
                ▼
              </span>
            )}
          </button>
          {!editandoOcorrencia && (
            <button
              onClick={() => {
                setTextoOcorrencia(pedido.ocorrencias ?? '')
                setEditandoOcorrencia(true)
                setOcorrenciaVisivel(true)
              }}
              className="shrink-0 text-xs text-slate-500 hover:text-rose-400"
            >
              {pedido.ocorrencias ? 'Editar' : '+ Registrar'}
            </button>
          )}
        </div>

        {editandoOcorrencia ? (
          <div className="mt-2">
            <textarea
              autoFocus
              rows={3}
              value={textoOcorrencia}
              onChange={(e) => setTextoOcorrencia(e.target.value)}
              placeholder="ex.: está faltando 1 uniforme tamanho M"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-rose-500"
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => void salvarOcorrencia()}
                disabled={salvandoOcorrencia}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {salvandoOcorrencia ? 'Salvando…' : 'Salvar'}
              </button>
              <button
                onClick={() => setEditandoOcorrencia(false)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : pedido.ocorrencias ? (
          <div
            className={`grid transition-all duration-300 ease-in-out ${
              ocorrenciaVisivel ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            }`}
          >
            <div className="overflow-hidden">
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-rose-200">
                {pedido.ocorrencias}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-600">
            Sem ocorrências. Registre aqui se faltar peça, houver troca ou avaria.
          </p>
        )}
      </div>

      {/* Fichas técnicas (uma por modelagem) — base do Mapa de Corte */}
      <FichasTecnicas pedidoId={pedido.id} numeroPedido={pedido.numero} />

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
                  {emAndamento && (
                    <span
                      title="Etapa em andamento"
                      className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 align-middle"
                    />
                  )}
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
                  {h.via_voz && (
                    <span
                      title="Via comando de voz"
                      className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400"
                    >
                      voz
                    </span>
                  )}
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
                      <div
                        key={a.id}
                        className={`group relative overflow-hidden rounded-lg border border-slate-800 hover:border-red-500 ${
                          apagandoAnexo === a.id ? 'opacity-40' : ''
                        }`}
                      >
                        <button
                          onClick={() => void abrirImagem(a)}
                          title={a.nome}
                          className="block w-full"
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
                        <button
                          onClick={() => void baixarFoto(a.path, a.nome)}
                          disabled={baixandoFoto === a.path}
                          title="Baixar foto em qualidade original"
                          className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950/80 text-xs text-slate-300 transition-opacity hover:bg-sky-700 hover:text-white md:opacity-0 md:focus:opacity-100 md:group-hover:opacity-100"
                        >
                          {baixandoFoto === a.path ? '…' : '↓'}
                        </button>
                        {podeGerenciar && (
                          <button
                            onClick={() => void excluirAnexo(a)}
                            disabled={apagandoAnexo === a.id}
                            title="Apagar foto"
                            /* no celular não existe hover: fica sempre visível */
                            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950/80 text-xs text-slate-300 transition-opacity hover:bg-rose-600 hover:text-white md:opacity-0 md:focus:opacity-100 md:group-hover:opacity-100"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              )}

              {/* Demais arquivos (PDFs, artes, documentos) */}
              <ul className="space-y-2">
                {anexos
                  .filter((a) => !urlsImagens[a.path])
                  .map((a) => (
                    <li
                      key={a.id}
                      className={`flex items-center gap-2 rounded-lg border border-slate-800 pr-2 hover:border-slate-600 ${
                        apagandoAnexo === a.id ? 'opacity-40' : ''
                      }`}
                    >
                      {/* abre o visualizador em aba própria (link normal: sem bloqueio de pop-up) */}
                      <a
                        href={`/anexo/${a.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-w-0 flex-1 items-center gap-3 p-2.5 text-left"
                      >
                        <span className="rounded border border-slate-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {a.tipo.startsWith('image/') ? 'Img' : a.tipo.includes('pdf') ? 'PDF' : 'Arq'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{a.nome}</span>
                          <span className="block text-xs text-slate-500">
                            {(a.tamanho / 1024).toFixed(0)} KB • {a.uploader?.nome ?? ''} •{' '}
                            {formatarDataHora(a.created_at)}
                          </span>
                        </span>
                      </a>
                      {podeGerenciar && (
                        <button
                          onClick={() => void excluirAnexo(a)}
                          disabled={apagandoAnexo === a.id}
                          title="Apagar arquivo"
                          className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-800 hover:text-rose-400 disabled:opacity-40"
                        >
                          🗑
                        </button>
                      )}
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
            <button
              onClick={(e) => {
                e.stopPropagation()
                void baixarFoto(imagemAberta.path, imagemAberta.nome)
              }}
              disabled={baixandoFoto === imagemAberta.path}
              className="rounded-lg bg-sky-900 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-800 disabled:opacity-50"
            >
              {baixandoFoto === imagemAberta.path ? 'Baixando…' : '↓ Baixar original'}
            </button>
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
