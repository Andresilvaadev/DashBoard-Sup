import type { ItemKit, Kit } from '../types'

/**
 * Itens que podem compor um kit, na ordem em que aparecem no formulário.
 * O plural fica junto porque "2 camisas" e "2 ecobags" não seguem a mesma
 * regra, e escrever isso na mão em cada tela dá divergência.
 */
export const ITENS_KIT: { id: ItemKit; rotulo: string; plural: string }[] = [
  { id: 'camisa', rotulo: 'Camisa', plural: 'camisas' },
  { id: 'caneca', rotulo: 'Caneca', plural: 'canecas' },
  { id: 'tirante', rotulo: 'Tirante', plural: 'tirantes' },
  { id: 'ecobag', rotulo: 'Ecobag', plural: 'ecobags' },
  { id: 'sacolinha', rotulo: 'Sacolinha', plural: 'sacolinhas' },
  { id: 'pulseira', rotulo: 'Pulseira', plural: 'pulseiras' },
]

/** Kits antigos ou vazios chegam como null/{}; normaliza para um objeto. */
const seguro = (kit: Kit | null | undefined): Kit => kit ?? {}

/** true quando o pedido foi cadastrado como kit (tem ao menos um item) */
export const ehKit = (kit: Kit | null | undefined): boolean =>
  ITENS_KIT.some(({ id }) => (seguro(kit)[id] ?? 0) > 0)

/** Soma das peças do kit — é o que vale como quantidade do pedido */
export const totalKit = (kit: Kit | null | undefined): number =>
  ITENS_KIT.reduce((soma, { id }) => soma + (seguro(kit)[id] ?? 0), 0)

/** Itens marcados, na ordem do formulário, prontos para exibição */
export const itensDoKit = (kit: Kit | null | undefined) =>
  ITENS_KIT.map(({ id, rotulo, plural }) => ({
    id,
    rotulo,
    plural,
    quantidade: seguro(kit)[id] ?? 0,
  })).filter((i) => i.quantidade > 0)

/** Resumo em uma linha: "30 camisas · 30 canecas · 50 pulseiras" */
export const resumoKit = (kit: Kit | null | undefined): string =>
  itensDoKit(kit)
    .map((i) => `${i.quantidade} ${i.quantidade === 1 ? i.rotulo.toLowerCase() : i.plural}`)
    .join(' · ')
