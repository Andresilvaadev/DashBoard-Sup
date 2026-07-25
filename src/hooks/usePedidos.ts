import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import type { Pedido } from '../types'

// ============================================================
// Loja compartilhada de pedidos (cache + realtime únicos).
// Antes, cada componente que usava usePedidos() fazia SUA PRÓPRIA
// consulta e abria SEU PRÓPRIO canal realtime. Agora existe UMA
// consulta e UM canal para o app inteiro; todos os consumidores
// leem do mesmo cache e re-renderizam juntos.
// A interface do hook não mudou: { pedidos, loading, recarregar }.
// ============================================================

interface Estado {
  pedidos: Pedido[]
  loading: boolean
  recarregar: () => Promise<void>
}

let estado: Estado = { pedidos: [], loading: true, recarregar }
const ouvintes = new Set<() => void>()
let consumidores = 0
let canal: ReturnType<typeof supabase.channel> | null = null
let carregando: Promise<void> | null = null

function emitir(parcial: Partial<Estado>) {
  estado = { ...estado, ...parcial }
  for (const o of ouvintes) o()
}

async function recarregar(): Promise<void> {
  // deduplica: se já há uma consulta em voo, reaproveita a mesma Promise
  if (carregando) return carregando
  carregando = (async () => {
    try {
      const { data, error } = await supabase
        .from('pedidos')
        .select('*, etapa_atual:etapas(*)')
        .order('created_at', { ascending: false })
      if (!error) emitir({ pedidos: (data as Pedido[]) ?? [], loading: false })
      else emitir({ loading: false })
    } finally {
      carregando = null
    }
  })()
  return carregando
}

function conectar() {
  if (canal) return
  canal = supabase
    .channel('pedidos-store')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => void recarregar())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'historico' }, () => void recarregar())
    .subscribe()
}

function desconectar() {
  if (canal) {
    supabase.removeChannel(canal)
    canal = null
  }
}

function assinar(cb: () => void) {
  ouvintes.add(cb)
  return () => ouvintes.delete(cb)
}

/** Lista de pedidos com atualização em tempo real (cache único para o app todo). */
export function usePedidos() {
  useEffect(() => {
    consumidores++
    if (consumidores === 1) conectar()
    // sempre revalida ao (re)montar — barato, pois é deduplicado
    void recarregar()
    return () => {
      consumidores--
      if (consumidores === 0) desconectar()
    }
  }, [])

  return useSyncExternalStore(assinar, () => estado)
}
