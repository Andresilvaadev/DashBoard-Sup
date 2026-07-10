import type { Etapa } from '../types'

export interface ComandoVoz {
  numero: number | null
  etapa: Etapa | null
  confiavel: boolean
  transcricao: string
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Converte números falados por extenso que o reconhecedor às vezes retorna */
const NUMEROS_EXTENSO: Record<string, string> = {
  um: '1', uma: '1', dois: '2', duas: '2', tres: '3', quatro: '4', cinco: '5',
  seis: '6', sete: '7', oito: '8', nove: '9', zero: '0', dez: '10',
}

/**
 * Interpreta frases como:
 *  "1234 corte" | "pedido 1234 foi para costura" | "pedido 1234 foi entregue"
 */
export function interpretarComando(
  transcricao: string,
  confidence: number,
  etapas: Etapa[],
): ComandoVoz {
  let texto = normalizar(transcricao)
  texto = texto
    .split(' ')
    .map((p) => NUMEROS_EXTENSO[p] ?? p)
    .join(' ')
  // junta dígitos separados por espaço ("1 2 3 4" -> "1234")
  texto = texto.replace(/\b(\d)\s+(?=\d\b)/g, '$1')

  const matchNumero = texto.match(/\d{1,8}/)
  const numero = matchNumero ? parseInt(matchNumero[0], 10) : null

  let etapa: Etapa | null = null
  let melhorPos = -1
  for (const e of etapas.filter((e) => e.ativo)) {
    const termos = [normalizar(e.nome), ...e.palavras_chave.map(normalizar)].filter(Boolean)
    for (const termo of termos) {
      const pos = texto.indexOf(termo)
      // usa a ocorrência mais à direita (a etapa costuma vir depois do número)
      if (pos > melhorPos) {
        melhorPos = pos
        etapa = e
      }
    }
  }

  const confiavel = confidence >= 0.75 && numero !== null && etapa !== null

  return { numero, etapa, confiavel, transcricao }
}

// ---------- Comando de voz do ESTOQUE ----------

export interface ItemEstoqueVoz {
  id: string
  nome: string
  quantidade: number
}

export interface ComandoEstoque {
  item: { id: string; nome: string; quantidadeAtual: number } | null
  /** 'adicionar' soma ao estoque; 'baixa' diminui */
  operacao: 'adicionar' | 'baixa'
  /** quantidade (sempre positiva; padrão 1) */
  quantidade: number
  confiavel: boolean
  transcricao: string
}

// palavras que indicam ENTRADA (compra/reposição) — somam ao estoque
const PALAVRAS_ADICIONAR = new Set([
  'comprei', 'comprar', 'compra', 'comprado', 'comprados', 'compramos',
  'adicionar', 'adiciona', 'adicione', 'adicionei', 'somar', 'soma', 'some',
  'repor', 'repus', 'reponha', 'chegou', 'chegaram', 'recebi', 'recebemos',
  'entrou', 'entraram', 'entrada', 'mais',
])

/**
 * Interpreta frases de baixa de estoque, ex.:
 *  "usei um dry fit titânio" | "dar baixa em caneca 800" | "dois algodão azul"
 * Extrai a quantidade (número por extenso, padrão 1) e o item de melhor
 * correspondência pelo nome. Só é confiável quando TODAS as palavras do nome
 * do item aparecem na fala; senão, o botão pede confirmação.
 */
export function interpretarComandoEstoque(
  transcricao: string,
  confidence: number,
  itens: ItemEstoqueVoz[],
): ComandoEstoque {
  const texto = normalizar(transcricao)
  const palavras = texto.split(' ').filter(Boolean)

  // entrada (compra) soma; sem palavra de entrada, o padrão é baixa (consumo)
  const operacao: 'adicionar' | 'baixa' = palavras.some((p) => PALAVRAS_ADICIONAR.has(p))
    ? 'adicionar'
    : 'baixa'

  // encontra o item pelo melhor casamento de palavras do nome
  let melhor: ItemEstoqueVoz | null = null
  let melhorScore = 0
  let melhorTotal = 0
  let melhorTokens: string[] = []
  for (const it of itens) {
    const nomePalavras = normalizar(it.nome).split(' ').filter(Boolean)
    if (nomePalavras.length === 0) continue
    const score = nomePalavras.filter((w) => palavras.includes(w)).length
    if (score > melhorScore) {
      melhorScore = score
      melhorTotal = nomePalavras.length
      melhor = it
      melhorTokens = nomePalavras
    }
  }

  // quantidade: primeiro número (por extenso ou dígito) que NÃO faça parte do
  // nome do item — evita confundir com números no nome (ex.: "caneca 800")
  let quantidade = 1
  for (const p of palavras) {
    if (melhorTokens.includes(p)) continue
    if (NUMEROS_EXTENSO[p] != null) {
      quantidade = Number(NUMEROS_EXTENSO[p])
      break
    }
    if (/^\d{1,3}$/.test(p)) {
      quantidade = Number(p)
      break
    }
  }
  if (quantidade < 1) quantidade = 1

  // confiável só quando todas as palavras do nome bateram (evita mexer no item errado)
  const confiavel = !!melhor && confidence >= 0.7 && melhorScore >= melhorTotal

  return {
    item: melhor
      ? { id: melhor.id, nome: melhor.nome, quantidadeAtual: Number(melhor.quantidade) }
      : null,
    operacao,
    quantidade,
    confiavel,
    transcricao,
  }
}
