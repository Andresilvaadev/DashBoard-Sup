import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// Loja compartilhada de configurações (cache + realtime únicos).
// Mesma interface de antes: { valores, capacidadeDiaria, metaDiaria,
// salvar, loading, recarregar }.
// ============================================================

interface Estado {
  valores: Record<string, string>
  capacidadeDiaria: number
  metaDiaria: number
  salvar: (chave: string, valor: string) => Promise<string | null>
  loading: boolean
  recarregar: () => Promise<void>
}

const num = (v: string | undefined) => Math.max(0, Number(v ?? 0) || 0)

let estado: Estado = {
  valores: {},
  capacidadeDiaria: 0,
  metaDiaria: 0,
  salvar,
  loading: true,
  recarregar,
}
const ouvintes = new Set<() => void>()
let consumidores = 0
let canal: ReturnType<typeof supabase.channel> | null = null
let carregando: Promise<void> | null = null

function emitir(valores: Record<string, string>, loading: boolean) {
  estado = {
    valores,
    capacidadeDiaria: num(valores['capacidade_diaria']),
    metaDiaria: num(valores['meta_diaria']),
    salvar,
    loading,
    recarregar,
  }
  for (const o of ouvintes) o()
}

async function recarregar(): Promise<void> {
  if (carregando) return carregando
  carregando = (async () => {
    try {
      const { data, error } = await supabase.from('config').select('chave, valor')
      if (!error) {
        const mapa: Record<string, string> = {}
        for (const c of (data ?? []) as { chave: string; valor: string }[]) mapa[c.chave] = c.valor
        emitir(mapa, false)
      } else {
        emitir(estado.valores, false)
      }
    } finally {
      carregando = null
    }
  })()
  return carregando
}

/** grava (upsert) uma configuração — apenas admin passa pela RLS */
async function salvar(chave: string, valor: string): Promise<string | null> {
  const { error } = await supabase
    .from('config')
    .upsert({ chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' })
  if (!error) emitir({ ...estado.valores, [chave]: valor }, estado.loading)
  return error?.message ?? null
}

function conectar() {
  if (canal) return
  canal = supabase
    .channel('config-store')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, () => void recarregar())
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

/** Configurações do sistema (ex.: capacidade/meta diária) com cache único. */
export function useConfig() {
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
