import { useEffect, useState, type FormEvent } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { useEtapas } from '../../hooks/useEtapas'
import { supabase } from '../../lib/supabase'
import type { Meta } from '../../types'
import { formatarData, hojeISO } from '../../utils/tempo'

export default function Metas() {
  const toast = useToast()
  const { etapasAtivas } = useEtapas()
  const [metas, setMetas] = useState<Meta[]>([])
  const [data, setData] = useState(hojeISO())
  const [etapaId, setEtapaId] = useState('') // '' = meta geral (conclusão)
  const [quantidade, setQuantidade] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = async () => {
    const { data: m } = await supabase
      .from('metas')
      .select('*, etapa:etapas(*)')
      .order('data', { ascending: false })
      .limit(60)
    setMetas((m as Meta[]) ?? [])
  }
  useEffect(() => {
    carregar()
  }, [])

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    setSalvando(true)
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('metas').upsert(
      {
        data,
        etapa_id: etapaId || null,
        quantidade: parseInt(quantidade, 10) || 0,
        created_by: userData.user?.id,
      },
      { onConflict: 'data,etapa_id' },
    )
    setSalvando(false)
    if (error) toast(error.message, 'erro')
    else {
      toast('Meta salva.', 'sucesso')
      setQuantidade('')
      carregar()
    }
  }

  const excluir = async (m: Meta) => {
    const { error } = await supabase.from('metas').delete().eq('id', m.id)
    if (error) toast(error.message, 'erro')
    else carregar()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form onSubmit={salvar} className="h-fit rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-sm font-semibold">Definir meta diária</h2>
        <p className="mt-1 text-xs text-slate-500">
          Meta geral (pedidos concluídos no dia) ou meta de uma etapa específica (pedidos que
          passam por ela no dia).
        </p>
        <div className="mt-4">
          <label className="text-xs font-medium text-slate-400">Etapa</label>
          <select
            value={etapaId}
            onChange={(e) => setEtapaId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500"
          >
            <option value="">Geral — pedidos concluídos no dia</option>
            {etapasAtivas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.ordem}. {e.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-400">Data</label>
            <input
              type="date"
              required
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400">Quantidade</label>
            <input
              type="number"
              required
              min={1}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={salvando}
          className="mt-4 w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : 'Salvar meta'}
        </button>
      </form>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="mb-3 text-sm font-semibold">Metas recentes</h2>
        {metas.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Nenhuma meta definida.</p>
        ) : (
          <ul className="space-y-2">
            {metas.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={m.data === hojeISO() ? 'shrink-0 font-semibold text-red-400' : 'shrink-0'}>
                    {formatarData(m.data)}
                    {m.data === hojeISO() && ' (hoje)'}
                  </span>
                  {m.etapa_id ? (
                    <span
                      className="truncate rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ background: `${m.etapa?.cor ?? '#ec1c24'}22`, color: m.etapa?.cor ?? '#ec1c24' }}
                    >
                      {m.etapa?.nome ?? 'Etapa removida'}
                    </span>
                  ) : (
                    <span className="truncate rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                      Geral
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-4">
                  <span className="font-semibold">{m.quantidade} pedidos</span>
                  <button
                    onClick={() => void excluir(m)}
                    className="text-xs text-slate-500 hover:text-rose-400"
                  >
                    Excluir
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
