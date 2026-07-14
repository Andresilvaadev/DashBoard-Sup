import type { FluxoEtapa, TipoPedido } from '../types'

/**
 * Fonte única das "abas" de pedidos. Cada aba liga um tipo de pedido a um
 * fluxo de etapas e a uma rota. Para adicionar uma aba nova no futuro,
 * basta acrescentar um item aqui (e criar as etapas do fluxo no Admin → Fluxo).
 */
export interface Aba {
  tipo: TipoPedido
  fluxo: FluxoEtapa
  rota: string
  label: string
}

export const ABAS: Aba[] = [
  { tipo: 'pronto', fluxo: 'producao', rota: '/pedidos', label: 'Pedidos' },
  { tipo: 'criacao', fluxo: 'criacao', rota: '/criacao', label: 'Criação' },
  { tipo: 'caneca', fluxo: 'caneca', rota: '/canecas', label: 'Canecas' },
]

export const abaDoTipo = (tipo: TipoPedido | null | undefined): Aba =>
  ABAS.find((a) => a.tipo === (tipo ?? 'pronto')) ?? ABAS[0]

export const fluxoDoTipo = (tipo: TipoPedido | null | undefined): FluxoEtapa =>
  abaDoTipo(tipo).fluxo
