import { useEffect, useState } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { supabase } from '../../lib/supabase'
import { removerAnexosStorage } from '../../utils/storage'

const PALAVRA_CONFIRMACAO = 'ZERAR'

/** Zona de perigo: zerar toda a produção antes de entregar o sistema ao cliente. */
export default function Sistema() {
  const toast = useToast()
  const [contagens, setContagens] = useState({ pedidos: 0, historico: 0, anexos: 0, metas: 0 })
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

  return (
    <div className="max-w-2xl space-y-4">
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

      <div className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-5">
        <h2 className="text-sm font-semibold text-rose-300">⚠️ Zona de perigo</h2>
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
