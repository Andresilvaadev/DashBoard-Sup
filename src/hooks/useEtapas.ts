import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import type { Etapa, FluxoEtapa } from '../types'

// ============================================================
// Loja compartilhada de etapas (cache + realtime únicos).
// useEtapas() é montado por muitas telas ao mesmo tempo; antes cada
// montagem repetia a consulta e abria um canal próprio. Agora há UMA
// consulta e UM canal; as listas derivadas (por fluxo) são calculadas
// uma única vez por atualização, não a cada render.
// A interface do hook não mudou.
// ============================================================

interface Estado {
  etapas: Etapa[]
  etapasAtivas: Etapa[]
  etapasCriacao: Etapa[]
  etapasDoFluxo: (fluxo: FluxoEtapa) => Etapa[]
  loading: boolean
  recarregar: () => Promise<void>
}

const porFluxo = new Map<FluxoEtapa, Etapa[]>()
const etapasDoFluxo = (fluxo: FluxoEtapa) => porFluxo.get(fluxo) ?? []

let estado: Estado = {
  etapas: [],
  etapasAtivas: [],
  etapasCriacao: [],
  etapasDoFluxo,
  loading: true,
  recarregar,
}
const ouvintes = new Set<() => void>()
let consumidores = 0
let canal: ReturnType<typeof supabase.channel> | null = null
let carregando: Promise<void> | null = null

function emitir(etapas: Etapa[], loading: boolean) {
  // deriva as listas por fluxo UMA vez por atualização
  porFluxo.clear()
  for (const e of etapas) {
    if (!e.ativo) continue
    const f = (e.fluxo ?? 'producao') as FluxoEtapa
    const lista = porFluxo.get(f) ?? []
    lista.push(e)
    porFluxo.set(f, lista)
  }
  estado = {
    etapas,
    etapasAtivas: etapasDoFluxo('producao'),
    etapasCriacao: etapasDoFluxo('criacao'),
    etapasDoFluxo,
    loading,
    recarregar,
  }
  for (const o of ouvintes) o()
}

async function recarregar(): Promise<void> {
  if (carregando) return carregando
  carregando = (async () => {
    try {
      const { data, error } = await supabase.from('etapas').select('*').order('ordem')
      if (!error) emitir((data as Etapa[]) ?? [], false)
      else emitir(estado.etapas, false)
    } finally {
      carregando = null
    }
  })()
  return carregando
}

function conectar() {
  if (canal) return
  canal = supabase
    .channel('etapas-store')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'etapas' }, () => void recarregar())
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

export function useEtapas() {
  useEffect(() => {
    consumidores++
    if (consumidores === 1) conectar()
    void recarregar()
    return () => {
      consumidores--
      if (consumidores === 0) desconectar()
    }
  }, [])

  return useSyncExternalStore(assinar, () => estado)
}
