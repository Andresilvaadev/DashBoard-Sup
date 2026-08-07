// Documento do cliente (CPF ou CNPJ), compartilhado pelo dashboard e pelo
// Portal do Cliente. É guardado no banco só com dígitos; a pontuação é
// cosmética e a comparação sempre ignora ela.

/** Deixa só os dígitos */
export const soDigitos = (v: string) => v.replace(/\D/g, '')

/**
 * Formata enquanto a pessoa digita:
 * até 11 dígitos → CPF 000.000.000-00
 * acima disso    → CNPJ 00.000.000/0000-00
 */
export function formatarDocumento(valor: string): string {
  const d = soDigitos(valor).slice(0, 14)

  if (d.length <= 11) {
    if (d.length <= 3) return d
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  }

  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/**
 * Aceita CPF (11 dígitos) ou CNPJ (14).
 *
 * De propósito NÃO confere os dígitos verificadores: quem decide se o
 * documento vale é a comparação com o que está gravado no pedido. Bloquear
 * aqui só criaria falso negativo — recusaria um CNPJ, ou um número que a
 * empresa cadastrou exatamente assim no pedido.
 */
export function documentoValido(valor: string): boolean {
  const n = soDigitos(valor).length
  return n === 11 || n === 14
}

/** Nome do documento, para mensagens ("CPF" ou "CNPJ") */
export const nomeDocumento = (valor: string) =>
  soDigitos(valor).length > 11 ? 'CNPJ' : 'CPF'
