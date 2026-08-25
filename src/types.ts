/**
 * admin       — acesso total (funcionários, fluxo, metas, sistema…)
 * gestor      — "Gestor": cria/edita pedidos (Pedidos, Criação, Canecas) e o Semanal
 * funcionario — apenas move os pedidos de etapa
 */
export type Role = 'admin' | 'gestor' | 'funcionario'
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
  /** true = etapa entra nos contadores de peças produzidas (corte, costura…) */
  conta_pecas: boolean
  /** capacidade (teto) da etapa em peças/dia (0 = não definida) */
  capacidade: number
  /** meta (alvo) diária da etapa em peças/dia (0 = não definida) */
  meta: number
}

export interface Pedido {
  id: string
  numero: number
  cliente: string
  /** Código de acesso ao Portal — o cliente usa este código para consultar o pedido */
  cpf: string | null
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
  /** flag interno da aba Criação: artista marca quando a arte está pronta para envio ao cliente */
  arte_concluida: boolean
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
  /** quando o anexo pertence a uma ficha técnica específica */
  ficha_id?: string | null
  nome: string
  path: string
  tipo: string
  tamanho: number
  uploaded_by: string | null
  created_at: string
  uploader?: Pick<Profile, 'id' | 'nome'>
}

/** Grade de tamanhos: { PP: 4, P: 12, M: 28 } — cada unidade = 1 par (frente+costa) */
export type Grade = Record<string, number>

/** Ficha técnica: uma por modelagem dentro do pedido */
export interface FichaTecnica {
  id: string
  pedido_id: string
  modelagem: string
  tecido: string
  gola: string
  manga: string
  punho: string
  estampa: string
  grade: Grade
  observacoes: string
  /** id do anexo marcado como Layout de Corte (só um por ficha) */
  layout_anexo_id: string | null
  created_at: string
  pedido?: Pick<Pedido, 'id' | 'numero' | 'cliente' | 'created_at'>
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

/** Setor do planejamento da semana (criado pelo admin, ex.: Prensagem, Costura) */
export interface SemanaSetor {
  id: string
  nome: string
  cor: string
  ordem: number
  created_at: string
}

/** Item do planejamento da semana (referência ao pedido; ele continua na aba dele) */
export interface PlanoSemana {
  id: string
  pedido_id: string | null
  /** setor onde o trabalho deve acontecer */
  setor_id: string | null
  dia: string
  texto: string
  feito: boolean
  created_by: string | null
  created_at: string
}

/** Retrato do que foi cortado, guardado ao concluir o lote */
export interface ResumoCorte {
  pedidos: { numero: number; cliente: string }[]
  modelagens: { modelagem: string; grade: Grade; total: number }[]
  totalPares: number
}

/**
 * Partes cortadas de um tamanho: o corpo da peça e as mangas saem em
 * momentos diferentes, e o tamanho só fica pronto com os dois cortados.
 */
export interface PartesCorte {
  camisa: boolean
  manga: boolean
}

/** Lote de corte: pedidos selecionados + progresso por tamanho */
export interface LoteCorte {
  id: string
  pedido_ids: string[]
  /**
   * { "MANGA LONGA": { "M MASC": { camisa: true, manga: false } } }
   * Lotes antigos gravavam só `true`/`false`; continuam sendo lidos.
   */
  progresso: Record<string, Record<string, boolean | Partial<PartesCorte> | null>>
  /** preenchido ao concluir — base do relatório de cortes */
  resumo?: ResumoCorte | Record<string, never>
  finalizado_em: string | null
  finalizado_por?: string | null
  created_by: string | null
  created_at: string
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
