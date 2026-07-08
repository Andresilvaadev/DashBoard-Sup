import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Pedido } from '../types'

/** Lista de pedidos com atualização em tempo real (Supabase Realtime). */
export function usePedidos() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from('pedidos')
      .select('*, etapa_atual:etapas(*)')
      .order('created_at', { ascending: false })
    setPedidos((data as Pedido[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    carregar()
    // nome único por instância (evita conflito quando o hook é montado em
    // mais de um componente ou remontado pelo StrictMode)
    const canal = supabase
      .channel(`pedidos-rt-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, carregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'historico' }, carregar)
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [carregar])

  return { pedidos, loading, recarregar: carregar }
}
