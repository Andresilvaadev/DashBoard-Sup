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
  um: '1', dois: '2', tres: '3', quatro: '4', cinco: '5',
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
