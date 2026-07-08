export type Role = 'admin' | 'funcionario'
export type StatusPedido = 'em_andamento' | 'concluido' | 'cancelado'
export type Prioridade = 'baixa' | 'normal' | 'alta' | 'urgente'

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
}

export interface Pedido {
  id: string
  numero: number
  cliente: string
  descricao: string
  quantidade: number
  prioridade: Prioridade
  status: StatusPedido
  etapa_atual_id: string | null
  data_prevista: string | null
  concluido_em: string | null
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
