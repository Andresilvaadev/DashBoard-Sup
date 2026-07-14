import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Etapa, FluxoEtapa } from '../types'

export function useEtapas() {
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [loading, setLoading] = useState(true)

  const carregar = async () => {
    const { data } = await supabase.from('etapas').select('*').order('ordem')
    setEtapas((data as Etapa[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    carregar()
    // nome único por instância: vários componentes usam este hook ao mesmo
    // tempo e canais com o mesmo nome não podem receber novos callbacks
    const canal = supabase
      .channel(`etapas-rt-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'etapas' }, carregar)
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [])

  const etapasDoFluxo = (fluxo: FluxoEtapa) =>
    etapas.filter((e) => e.ativo && (e.fluxo ?? 'producao') === fluxo)

  return {
    etapas,
    /** etapas ativas do fluxo de PRODUÇÃO (aba Pedidos) */
    etapasAtivas: etapasDoFluxo('producao'),
    /** etapas ativas do fluxo de CRIAÇÃO de arte (aba Criação) */
    etapasCriacao: etapasDoFluxo('criacao'),
    /** etapas ativas de um fluxo qualquer (producao/criacao/caneca) */
    etapasDoFluxo,
    loading,
    recarregar: carregar,
  }
}
