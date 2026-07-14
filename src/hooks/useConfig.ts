import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Lê e grava configurações do sistema (tabela config, chave/valor).
 * Ex.: capacidade_diaria = quantas peças a produção comporta por dia.
 */
export function useConfig() {
  const [valores, setValores] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const carregar = async () => {
    const { data } = await supabase.from('config').select('chave, valor')
    const mapa: Record<string, string> = {}
    for (const c of (data ?? []) as { chave: string; valor: string }[]) mapa[c.chave] = c.valor
    setValores(mapa)
    setLoading(false)
  }

  useEffect(() => {
    carregar()
    const canal = supabase
      .channel(`config-rt-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, carregar)
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [])

  /** grava (upsert) uma configuração — apenas admin passa pela RLS */
  const salvar = async (chave: string, valor: string) => {
    const { error } = await supabase
      .from('config')
      .upsert({ chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' })
    if (!error) setValores((v) => ({ ...v, [chave]: valor }))
    return error?.message ?? null
  }

  const capacidadeDiaria = Math.max(0, Number(valores['capacidade_diaria'] ?? 0) || 0)
  const metaDiaria = Math.max(0, Number(valores['meta_diaria'] ?? 0) || 0)

  return { valores, capacidadeDiaria, metaDiaria, salvar, loading, recarregar: carregar }
}
