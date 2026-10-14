import type { Etapa } from '../types'

// ============================================================
// Quando a peça foi PRODUZIDA (ficou pronta), que é diferente de quando
// foi ENTREGUE. Um pedido pode ficar pronto em setembro e só sair em
// outubro, porque o cliente ainda não pagou — a produção é de setembro.
// ============================================================

/**
 * Etapas que marcam "o pedido ficou pronto", por fluxo.
 *
 * É por fluxo porque "conferindo e embalando" existe nas duas abas: na
 * produção ela é uma etapa do meio, e nas canecas é o fim da produção.
 *
 * Os nomes são fixos a pedido da fábrica. Renomear a etapa no Admin →
 * Fluxo faz a contagem parar de achar a etapa — por isso
 * `temEtapaDePronto` existe, para a tela avisar em vez de mostrar zero.
 */
const PRONTO_POR_FLUXO: Record<string, RegExp> = {
  producao: /PRONT/,
  caneca: /CONFERIND|EMBAL/,
}

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()

/** A etapa significa "pedido pronto"? */
export const ehEtapaPronto = (e: Etapa): boolean => {
  const re = PRONTO_POR_FLUXO[e.fluxo ?? 'producao']
  return Boolean(re && e.ativo && re.test(semAcento(e.nome)))
}

/** ids das etapas de "pronto" (vazio = nenhuma etapa com esse nome) */
export const idsEtapasPronto = (etapas: Etapa[]): string[] =>
  etapas.filter(ehEtapaPronto).map((e) => e.id)

/** há ao menos uma etapa de "pronto" configurada? */
export const temEtapaDePronto = (etapas: Etapa[]): boolean => etapas.some(ehEtapaPronto)

/**
 * pedido → quando ficou pronto pela PRIMEIRA vez.
 *
 * Voltar para conserto e ficar pronto de novo não muda o mês em que a
 * peça foi produzida, e não conta duas vezes.
 */
export function prontoPorPedido(
  linhas: { pedido_id: string; entrada: string }[],
): Map<string, string> {
  const mapa = new Map<string, string>()
  for (const l of linhas) {
    if (!l.pedido_id || !l.entrada) continue
    const atual = mapa.get(l.pedido_id)
    if (!atual || l.entrada < atual) mapa.set(l.pedido_id, l.entrada)
  }
  return mapa
}

/**
 * Soma as peças dos pedidos que ficaram prontos no período.
 * `dentro` decide o que é o período (o mesmo usado nas outras contas).
 */
export function pecasProntas(
  pronto: Map<string, string>,
  pecasDoPedido: Map<string, number>,
  dentro: (iso: string) => boolean,
): { pecas: number; pedidos: number } {
  let pecas = 0
  let pedidos = 0
  for (const [id, quando] of pronto) {
    if (!dentro(quando)) continue
    pedidos++
    pecas += pecasDoPedido.get(id) ?? 0
  }
  return { pecas, pedidos }
}
