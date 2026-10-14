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

/** Uma linha do histórico, do jeito que as telas já carregam. */
export interface MovimentoEtapa {
  pedido_id: string
  etapa_id: string
  entrada?: string | null
  saida?: string | null
}

/**
 * Etapas PULADAS: as que o pedido saltou ao ir direto para uma etapa mais
 * à frente.
 *
 * Na prática a fábrica faz duas coisas ao mesmo tempo: corta e imprime
 * junto, e move o pedido direto de Corte para Prensagem. A impressão do
 * meio foi feita, mas não aparecia em lugar nenhum. Aqui ela conta, na
 * data do salto.
 *
 * Só vale para a FRENTE: voltar atrás não produziu nada.
 *
 * Não precisa de consulta nova — os dois lados do salto já vêm carregados,
 * porque sair de uma etapa e entrar na outra acontece no mesmo instante.
 */
export function etapasPuladas(
  entradas: MovimentoEtapa[],
  saidas: MovimentoEtapa[],
  etapas: Etapa[],
): Map<string, Set<string>> {
  const porId = new Map(etapas.map((e) => [e.id, e]))
  const saidasPorPedido = new Map<string, { etapa_id: string; quando: string }[]>()
  for (const s of saidas) {
    if (!s.saida) continue
    const lista = saidasPorPedido.get(s.pedido_id) ?? []
    lista.push({ etapa_id: s.etapa_id, quando: s.saida })
    saidasPorPedido.set(s.pedido_id, lista)
  }
  for (const lista of saidasPorPedido.values()) lista.sort((a, b) => a.quando.localeCompare(b.quando))

  const mapa = new Map<string, Set<string>>()
  for (const chegada of entradas) {
    if (!chegada.entrada) continue
    const destino = porId.get(chegada.etapa_id)
    if (!destino) continue
    // de onde ele veio: a última etapa que o pedido deixou até este instante
    let origem: Etapa | undefined
    for (const s of saidasPorPedido.get(chegada.pedido_id) ?? []) {
      if (s.quando > chegada.entrada) break
      origem = porId.get(s.etapa_id) ?? origem
    }
    if (!origem) continue
    const fluxo = destino.fluxo ?? 'producao'
    if ((origem.fluxo ?? 'producao') !== fluxo) continue
    // salto para trás ou para a etapa seguinte: não pulou nada
    if (destino.ordem <= origem.ordem + 1) continue
    for (const meio of etapas) {
      if (!meio.ativo || (meio.fluxo ?? 'producao') !== fluxo) continue
      if (meio.ordem <= origem.ordem || meio.ordem >= destino.ordem) continue
      const conjunto = mapa.get(meio.id) ?? new Set<string>()
      conjunto.add(chegada.pedido_id)
      mapa.set(meio.id, conjunto)
    }
  }
  return mapa
}
