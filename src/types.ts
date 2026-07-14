export type Role = 'admin' | 'funcionario'
export type StatusPedido = 'em_andamento' | 'concluido' | 'cancelado' | 'arquivado'
export type Prioridade = 'baixa' | 'normal' | 'alta' | 'urgente'
/** aba do pedido: Pedidos (pronto), Criação de arte (criacao), Canecas (caneca) */
export type TipoPedido = 'pronto' | 'criacao' | 'caneca'
/** fluxo de etapas: produção (Pedidos), criação (arte), caneca (Canecas) */
export type FluxoEtapa = 'producao' | 'criacao' | 'caneca'

export interface Profile {
  id: string
  nome: string
  email: string
  role: Role
  ativo: boolean
  created_at: string
}

export interface Etapa {
  id: string
  nome: string
  ordem: number
  cor: string
  palavras_chave: string[]
  ativo: boolean
  fluxo: FluxoEtapa
  /** capacidade (teto) da etapa em peças/dia (0 = não definida) */
  capacidade: number
  /** meta (alvo) diária da etapa em peças/dia (0 = não definida) */
  meta: number
}

export interface Pedido {
  id: string
  numero: number
  cliente: string
  descricao: string
  quantidade: number
  prioridade: Prioridade
  status: StatusPedido
  tipo: TipoPedido
  etapa_atual_id: string | null
  data_prevista: string | null
  concluido_em: string | null
  cancelado_em: string | null
  arquivado_em: string | null
  created_by: string | null
  created_at: string
  etapa_atual?: Etapa | null
}

export interface Historico {
  id: string
  pedido_id: string
  etapa_id: string
  funcionario_id: string | null
  entrada: string
  saida: string | null
  segundos_gastos: number | null
  observacao: string
  via_voz: boolean
  etapa?: Etapa
  funcionario?: Pick<Profile, 'id' | 'nome'>
  pedido?: Pick<Pedido, 'id' | 'numero' | 'cliente'>
}

export interface Anexo {
  id: string
  pedido_id: string
  nome: string
  path: string
  tipo: string
  tamanho: number
  uploaded_by: string | null
  created_at: string
  uploader?: Pick<Profile, 'id' | 'nome'>
}

export interface Meta {
  id: string
  data: string
  /** null = meta geral do dia (pedidos concluídos); senão, meta da etapa */
  etapa_id: string | null
  quantidade: number
  etapa?: Etapa | null
}

export interface Perda {
  id: string
  pedido_id: string | null
  funcionario_id: string | null
  material: string
  quantidade: number
  unidade: string
  /** valor financeiro perdido (R$) */
  valor: number
  motivo: string
  observacoes: string
  created_at: string
  funcionario?: Pick<Profile, 'id' | 'nome'> | null
  pedido?: Pick<Pedido, 'id' | 'numero' | 'cliente'> | null
}

export interface EstoqueCategoria {
  id: string
  nome: string
  ordem: number
  created_at: string
}

export interface EstoqueItem {
  id: string
  categoria_id: string
  nome: string
  quantidade: number
  ordem: number
  created_at: string
}
