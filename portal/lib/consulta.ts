// Camada de dados do Portal do Cliente.
//
// Usa o MESMO cliente Supabase e o MESMO banco do dashboard — não há
// duplicação de dados nem segunda API. Toda a consulta passa por uma única
// função no banco (`consultar_pedido_cliente`), que valida CPF + número e
// devolve apenas os campos públicos do pedido.

import { supabase } from '../../src/lib/supabase'
import { documentoValido, soDigitos } from '../../src/utils/cpf'

// reexporta para os componentes do portal (mesma implementação do dashboard)
export { formatarDocumento, documentoValido, soDigitos } from '../../src/utils/cpf'

/** Uma etapa do fluxo do pedido (base da barra de progresso) */
export interface EtapaPublica {
  nome: string
  ordem: number
  cor: string
}

/** Um movimento na linha do tempo — sem funcionário nem observações internas */
export interface MovimentoPublico {
  etapa: string
  cor: string
  data: string
}

/** Tudo que o cliente pode ver do pedido dele */
export interface PedidoPublico {
  numero: number
  cliente: string
  criado_em: string
  status: 'em_andamento' | 'concluido' | 'cancelado' | 'arquivado'
  etapa_atual: string | null
  etapa_ordem: number | null
  total_etapas: number | null
  atualizado_em: string
  previsao_entrega: string | null
  concluido_em: string | null
  etapas: EtapaPublica[]
  timeline: MovimentoPublico[]
}

/**
 * Consulta o pedido. Devolve null quando o número e o CPF não conferem —
 * a resposta é a mesma para "não existe" e "CPF errado", de propósito:
 * assim o portal não revela quais números de pedido existem.
 */
export async function consultarPedido(
  numero: string,
  cpf: string,
): Promise<{ pedido: PedidoPublico | null; erro: string | null }> {
  const num = parseInt(soDigitos(numero), 10)
  if (!num) return { pedido: null, erro: 'Informe o número do pedido.' }
  if (!documentoValido(cpf)) {
    return { pedido: null, erro: 'Digite o CPF completo (11 dígitos) ou o CNPJ (14 dígitos).' }
  }

  const { data, error } = await supabase.rpc('consultar_pedido_cliente', {
    p_numero: num,
    p_cpf: soDigitos(cpf),
  })

  if (error) {
    return { pedido: null, erro: 'Não foi possível consultar agora. Tente novamente em instantes.' }
  }
  if (!data) {
    return { pedido: null, erro: 'Pedido não encontrado ou CPF incorreto.' }
  }
  return { pedido: data as PedidoPublico, erro: null }
}
