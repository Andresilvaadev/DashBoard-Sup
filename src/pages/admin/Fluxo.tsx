import { useState, type FormEvent } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { useEtapas } from '../../hooks/useEtapas'
import { supabase } from '../../lib/supabase'
import type { Etapa } from '../../types'

/** Admin: criar, editar, reordenar e desativar etapas do fluxo de produção. */
export default function Fluxo() {
  const toast = useToast()
  const { etapas, recarregar } = useEtapas()
  const [editando, setEditando] = useState<Etapa | 'nova' | null>(null)
  const [nome, setNome] = useState('')
  const [cor, setCor] = useState('#ec1c24')
  const [palavras, setPalavras] = useState('')

  const abrir = (e: Etapa | 'nova') => {
    setEditando(e)
    if (e === 'nova') {
      setNome('')
      setCor('#ec1c24')
      setPalavras('')
    } else {
      setNome(e.nome)
      setCor(e.cor)
      setPalavras(e.palavras_chave.join(', '))
    }
  }

  const salvar = async (ev: FormEvent) => {
    ev.preventDefault()
    const palavras_chave = palavras
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
    let error
    if (editando === 'nova') {
      const maxOrdem = Math.max(0, ...etapas.map((e) => e.ordem))
      ;({ error } = await supabase.from('etapas').insert({ nome, cor, palavras_chave, ordem: maxOrdem + 1 }))
    } else if (editando) {
      ;({ error } = await supabase.from('etapas').update({ nome, cor, palavras_chave }).eq('id', editando.id))
    }
    if (error) toast(error.message, 'erro')
    else {
      toast('Fluxo atualizado.', 'sucesso')
      setEditando(null)
      recarregar()
    }
  }

  const mover = async (e: Etapa, dir: -1 | 1) => {
    const ativas = etapas
    const idx = ativas.findIndex((x) => x.id === e.id)
    const alvo = ativas[idx + dir]
    if (!alvo) return
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('etapas').update({ ordem: alvo.ordem }).eq('id', e.id),
      supabase.from('etapas').update({ ordem: e.ordem }).eq('id', alvo.id),
    ])
    if (e1 || e2) toast((e1 ?? e2)!.message, 'erro')
    else recarregar()
  }

  const alternarAtivo = async (e: Etapa) => {
    const { error } = await supabase.from('etapas').update({ ativo: !e.ativo }).eq('id', e.id)
    if (error) toast(error.message, 'erro')
    else recarregar()
  }

  const excluir = async (e: Etapa) => {
    if (!confirm(`Excluir a etapa "${e.nome}"? Se houver histórico usando esta etapa, ela será apenas desativada.`))
      return
    const { error } = await supabase.from('etapas').delete().eq('id', e.id)
    if (error) {
      // etapa referenciada pelo histórico: desativa em vez de excluir
      await supabase.from('etapas').update({ ativo: false }).eq('id', e.id)
      toast('Etapa em uso pelo histórico — foi desativada em vez de excluída.', 'info')
    } else {
      toast('Etapa excluída.', 'sucesso')
    }
    recarregar()
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          As <strong>palavras-chave</strong> são usadas pelos comandos de voz.
        </p>
        <button
          onClick={() => abrir('nova')}
          className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500"
        >
          + Nova etapa
        </button>
      </div>

      <div className="space-y-2">
        {etapas.map((e, i) => (
          <div
            key={e.id}
            className={`flex items-center gap-3 rounded-xl border bg-slate-900 p-3 ${
              e.ativo ? 'border-slate-800' : 'border-slate-800 opacity-50'
            }`}
          >
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => void mover(e, -1)}
                disabled={i === 0}
                className="text-slate-500 hover:text-red-400 disabled:opacity-30"
                aria-label="Subir"
              >
                ▲
              </button>
              <button
                onClick={() => void mover(e, 1)}
                disabled={i === etapas.length - 1}
                className="text-slate-500 hover:text-red-400 disabled:opacity-30"
                aria-label="Descer"
              >
                ▼
              </button>
            </div>
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-slate-950"
              style={{ background: e.cor }}
            >
              {e.ordem}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {e.nome}
                {!e.ativo && <span className="ml-2 text-xs text-slate-500">(desativada)</span>}
              </p>
              <p className="truncate text-xs text-slate-500">
                🎙️ {e.palavras_chave.join(', ') || 'sem palavras-chave'}
              </p>
            </div>
            <div className="flex shrink-0 gap-3 text-xs">
              <button onClick={() => abrir(e)} className="text-slate-400 hover:text-red-400">
                Editar
              </button>
              <button onClick={() => void alternarAtivo(e)} className="text-slate-400 hover:text-amber-400">
                {e.ativo ? 'Desativar' : 'Ativar'}
              </button>
              <button onClick={() => void excluir(e)} className="text-slate-400 hover:text-rose-400">
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>

      {editando && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 md:items-center">
          <form
            onSubmit={salvar}
            className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
          >
            <h2 className="text-lg font-bold">{editando === 'nova' ? 'Nova etapa' : `Editar "${editando.nome}"`}</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400">Nome *</label>
                <input required value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400">Cor</label>
                <input
                  type="color"
                  value={cor}
                  onChange={(e) => setCor(e.target.value)}
                  className="mt-1 h-10 w-full cursor-pointer rounded-lg border border-slate-700 bg-slate-950"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400">
                  Palavras-chave de voz (separadas por vírgula)
                </label>
                <input
                  value={palavras}
                  onChange={(e) => setPalavras(e.target.value)}
                  placeholder="corte, cortar, cortado"
                  className={inputCls}
                />
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setEditando(null)}
                className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm font-medium hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500"
              >
                Salvar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
