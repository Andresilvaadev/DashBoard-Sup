import type { Etapa, Pedido } from '../types'

/**
 * Pedidos criados DEPOIS deste que já estão numa etapa À FRENTE da etapa
 * atual dele (ou já foram concluídos) — ou seja, "furaram a fila".
 *
 * Um pedido mais novo que ainda está numa etapa anterior ou na mesma etapa
 * NÃO conta; ele só conta quando ultrapassa a etapa atual deste pedido.
 * Pedidos cancelados nunca contam.
 */
export function pedidosQuePassaramNaFrente(
  pedido: Pedido,
  todos: Pedido[],
  etapas: Etapa[],
): Pedido[] {
  if (pedido.status !== 'em_andamento') return []
  const ordemPorEtapa = new Map(etapas.map((e) => [e.id, e.ordem]))
  const minhaOrdem = pedido.etapa_atual_id ? ordemPorEtapa.get(pedido.etapa_atual_id) : undefined
  if (minhaOrdem == null) return []

  return todos.filter((outro) => {
    if (outro.id === pedido.id || outro.status === 'cancelado') return false
    // compara apenas pedidos da mesma aba (produção x criação têm fluxos próprios)
    if ((outro.tipo ?? 'pronto') !== (pedido.tipo ?? 'pronto')) return false
    // só pedidos criados depois deste (timestamps ISO comparam em ordem)
    if (outro.created_at <= pedido.created_at) return false
    // concluído = passou por todas as etapas, logo passou na frente
    if (outro.status === 'concluido') return true
    const ordemOutro = outro.etapa_atual_id ? ordemPorEtapa.get(outro.etapa_atual_id) : undefined
    return ordemOutro != null && ordemOutro > minhaOrdem
  })
}

/** Mapa pedido.id → quantos pedidos criados depois já passaram na frente. */
export function mapaUltrapassagens(pedidos: Pedido[], etapas: Etapa[]): Record<string, number> {
  const mapa: Record<string, number> = {}
  for (const p of pedidos) {
    if (p.status !== 'em_andamento') continue
    const n = pedidosQuePassaramNaFrente(p, pedidos, etapas).length
    if (n > 0) mapa[p.id] = n
  }
  return mapa
}
