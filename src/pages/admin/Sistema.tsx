import { useEffect, useState } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { supabase } from '../../lib/supabase'
import { removerAnexosStorage } from '../../utils/storage'

const PALAVRA_CONFIRMACAO = 'ZERAR'

// limite de armazenamento do plano grátis do Supabase
const LIMITE_BYTES = 1024 * 1024 * 1024 // 1 GB

const formatarMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`
const formatarTamanho = (bytes: number) =>
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    : `${(bytes / (1024 * 1024)).toFixed(0)} MB`

/** Zona de perigo: zerar toda a produção antes de entregar o sistema ao cliente. */
export default function Sistema() {
  const toast = useToast()
  const [contagens, setContagens] = useState({ pedidos: 0, historico: 0, anexos: 0, metas: 0 })
  const [resumoFotos, setResumoFotos] = useState({ qtd: 0, bytes: 0 })
  const [armazenamento, setArmazenamento] = useState({ bytes: 0, arquivos: 0 })
  const [liberando, setLiberando] = useState(false)
  const [modalAberto, setModalAberto] = useState(false)
  const [confirmacao, setConfirmacao] = useState('')
  const [zerando, setZerando] = useState(false)

  const carregarContagens = async () => {
    const contar = (tabela: string) =>
      supabase.from(tabela).select('*', { count: 'exact', head: true })
    const [p, h, a, m] = await Promise.all([
      contar('pedidos'),
      contar('historico'),
      contar('anexos'),
      contar('metas'),
    ])
    setContagens({
      pedidos: p.count ?? 0,
      historico: h.count ?? 0,
      anexos: a.count ?? 0,
      metas: m.count ?? 0,
    })
    const { paths, bytes } = await buscarFotosConcluidos()
    setResumoFotos({ qtd: paths.length, bytes })
    setArmazenamento(await somarArmazenamento())
  }

  // soma o tamanho de TODOS os anexos (páginas de 1000) para o medidor de armazenamento
  const somarArmazenamento = async () => {
    const PAGINA = 1000
    let bytes = 0
    let arquivos = 0
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data } = await supabase
        .from('anexos')
        .select('tamanho')
        .range(inicio, inicio + PAGINA - 1)
      const lote = (data ?? []) as { tamanho: number }[]
      for (const a of lote) bytes += a.tamanho ?? 0
      arquivos += lote.length
      if (lote.length < PAGINA) break
    }
    return { bytes, arquivos }
  }

  // fotos (anexos de imagem) de pedidos finalizados (concluídos ou arquivados) — candidatas a limpeza
  const buscarFotosConcluidos = async () => {
    const { data: concl } = await supabase
      .from('pedidos')
      .select('id')
      .in('status', ['concluido', 'arquivado'])
    const ids = (concl ?? []).map((p) => p.id as string)
    if (ids.length === 0) return { anexoIds: [], paths: [], bytes: 0 }
    const { data: anexos } = await supabase
      .from('anexos')
      .select('id, path, tamanho')
      .in('pedido_id', ids)
      .like('tipo', 'image/%')
    const lista = (anexos ?? []) as { id: string; path: string; tamanho: number }[]
    return {
      anexoIds: lista.map((x) => x.id),
      paths: lista.map((x) => x.path),
      bytes: lista.reduce((s, x) => s + (x.tamanho ?? 0), 0),
    }
  }

  const liberarEspaco = async () => {
    const { anexoIds, paths, bytes } = await buscarFotosConcluidos()
    if (paths.length === 0) {
      toast('Nenhuma foto de pedido concluído para apagar.', 'sucesso')
      return
    }
    if (
      !confirm(
        `Apagar ${paths.length} foto(s) de pedidos finalizados (~${formatarMB(bytes)})?\n\n` +
          'Os pedidos e o histórico são mantidos — só as imagens são removidas. Essa ação não pode ser desfeita.',
      )
    )
      return
    setLiberando(true)
    await removerAnexosStorage(paths)
    const { error } = await supabase.from('anexos').delete().in('id', anexoIds)
    setLiberando(false)
    if (error) toast(error.message, 'erro')
    else {
      toast('Espaço liberado. As fotos dos concluídos foram removidas.', 'sucesso')
      carregarContagens()
    }
  }

  useEffect(() => {
    carregarContagens()
  }, [])

  const zerar = async () => {
    if (confirmacao !== PALAVRA_CONFIRMACAO) return
    setZerando(true)
    const { data, error } = await supabase.rpc('zerar_producao')
    if (error) {
      setZerando(false)
      toast(error.message, 'erro')
      return
    }
    await removerAnexosStorage((data as string[]) ?? [])
    setZerando(false)
    setModalAberto(false)
    setConfirmacao('')
    toast('Produção zerada. O sistema está pronto para o cliente.', 'sucesso')
    carregarContagens()
  }

  const fecharModal = () => {
    if (zerando) return
    setModalAberto(false)
    setConfirmacao('')
  }

  const pctUso = Math.min(100, (armazenamento.bytes / LIMITE_BYTES) * 100)
  const corBarra = pctUso >= 85 ? 'bg-rose-500' : pctUso >= 60 ? 'bg-amber-500' : 'bg-emerald-500'
  const corTexto = pctUso >= 85 ? 'text-rose-400' : pctUso >= 60 ? 'text-amber-400' : 'text-emerald-400'

  return (
    <div className="max-w-2xl space-y-4">
      {/* Medidor de armazenamento (plano grátis do Supabase = 1 GB) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Armazenamento das fotos</h2>
          <span className={`text-sm font-bold ${corTexto}`}>{pctUso.toFixed(1)}%</span>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full transition-all ${corBarra}`}
            style={{ width: `${Math.max(pctUso, 1)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {formatarTamanho(armazenamento.bytes)} de 1 GB usados • {armazenamento.arquivos} arquivo(s)
        </p>
        {pctUso >= 85 ? (
          <p className="mt-1 text-xs text-rose-400">
            Armazenamento quase cheio. Use "Liberar espaço" abaixo ou considere o plano Pro.
          </p>
        ) : pctUso >= 60 ? (
          <p className="mt-1 text-xs text-amber-400">
            Já passou da metade. Fique de olho ou libere espaço das fotos dos finalizados.
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Espaço tranquilo. Mede só as fotos; a banda mensal aparece no painel do Supabase.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-sm font-semibold">Dados atuais</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['Pedidos', contagens.pedidos],
              ['Movimentações', contagens.historico],
              ['Anexos', contagens.anexos],
              ['Metas', contagens.metas],
            ] as const
          ).map(([rotulo, valor]) => (
            <div key={rotulo} className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-center">
              <p className="text-xl font-bold">{valor}</p>
              <p className="text-xs text-slate-500">{rotulo}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Liberar espaço: apaga as fotos dos concluídos, mantendo os registros */}
      <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-5">
        <h2 className="text-sm font-semibold text-amber-300">Liberar espaço</h2>
        <p className="mt-2 text-sm text-slate-400">
          Apaga as{' '}
          <span className="font-semibold text-slate-300">fotos dos pedidos finalizados</span>{' '}
          (concluídos ou arquivados) para não encher o armazenamento. Os pedidos, o histórico e os
          tempos são <span className="font-semibold text-slate-300">mantidos</span> — só as imagens
          são removidas.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          {resumoFotos.qtd > 0
            ? `${resumoFotos.qtd} foto(s) de pedidos finalizados ocupando ~${formatarMB(resumoFotos.bytes)}.`
            : 'Nenhuma foto de pedido finalizado no momento.'}
        </p>
        <button
          onClick={() => void liberarEspaco()}
          disabled={liberando || resumoFotos.qtd === 0}
          className="mt-4 rounded-lg border border-amber-800 bg-amber-950/60 px-4 py-2.5 text-sm font-semibold text-amber-300 hover:bg-amber-900/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {liberando ? 'Liberando…' : 'Liberar espaço das fotos'}
        </button>
      </div>

      <div className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-5">
        <h2 className="text-sm font-semibold text-rose-300">Zona de perigo</h2>
        <p className="mt-2 text-sm text-slate-400">
          <span className="font-semibold text-slate-300">Zerar produção</span> apaga
          definitivamente todos os pedidos, o histórico completo, os anexos e as metas — o
          dashboard e os relatórios voltam a zero. Use antes de entregar o sistema ao cliente,
          para que a contagem comece com os pedidos reais dele.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Funcionários, contas de acesso e as etapas do fluxo de produção são mantidos.
        </p>
        <button
          onClick={() => setModalAberto(true)}
          className="mt-4 rounded-lg border border-rose-800 bg-rose-950/60 px-4 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-900/60"
        >
          Zerar produção…
        </button>
      </div>

      {/* Confirmação protegida: exige digitar a palavra ZERAR */}
      {modalAberto && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
          onClick={fecharModal}
        >
          <div
            className="w-full max-w-md rounded-xl border border-rose-900 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-rose-300">Zerar toda a produção?</h3>
            <p className="mt-2 text-sm text-slate-400">
              Serão apagados <span className="font-semibold text-slate-200">{contagens.pedidos} pedidos</span>,{' '}
              <span className="font-semibold text-slate-200">{contagens.historico} movimentações</span>,{' '}
              <span className="font-semibold text-slate-200">{contagens.anexos} anexos</span> e{' '}
              <span className="font-semibold text-slate-200">{contagens.metas} metas</span>.{' '}
              <span className="font-semibold text-rose-300">Essa ação não pode ser desfeita.</span>
            </p>
            <label className="mt-4 block text-xs font-medium text-slate-400">
              Para confirmar, digite <span className="font-bold text-rose-300">{PALAVRA_CONFIRMACAO}</span> abaixo:
            </label>
            <input
              autoFocus
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value.toUpperCase())}
              placeholder={PALAVRA_CONFIRMACAO}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-rose-500"
            />
            <div className="mt-4 flex gap-3">
              <button
                onClick={fecharModal}
                disabled={zerando}
                className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                onClick={() => void zerar()}
                disabled={confirmacao !== PALAVRA_CONFIRMACAO || zerando}
                className="flex-1 rounded-lg bg-rose-700 py-2.5 text-sm font-semibold text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {zerando ? 'Zerando…' : 'Zerar tudo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
