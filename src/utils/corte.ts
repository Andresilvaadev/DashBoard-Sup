import type { FichaTecnica, Grade, PartesCorte } from '../types'

// ============================================================
// Lógica do Mapa de Corte (fora dos componentes).
// Regra da casa: cada unidade da grade = 1 PAR (frente + costa).
// O sistema nunca separa frente/costa — isso já faz parte do corte.
// ============================================================

/** Ordem natural dos tamanhos; desconhecidos vão para o fim, em ordem alfabética. */
const ORDEM_TAMANHOS = [
  'PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'EG', 'EGG',
  '1', '2', '4', '6', '8', '10', '12', '14', '16',
]

/** separa "M MASC" em base "M" + sexo "MASC" (para ordenar corretamente) */
function partes(t: string): { base: string; sexo: string } {
  const m = t.toUpperCase().trim().match(/^(.*?)\s*(MASC|FEM)$/)
  return m ? { base: m[1].trim(), sexo: m[2] } : { base: t.toUpperCase().trim(), sexo: '' }
}

export function ordenarTamanhos(tamanhos: string[]): string[] {
  return [...tamanhos].sort((a, b) => {
    const pa = partes(a)
    const pb = partes(b)
    // masculino antes de feminino; sem sexo (infantil) por último
    const ordemSexo = (s: string) => (s === 'MASC' ? 0 : s === 'FEM' ? 1 : 2)
    if (pa.sexo !== pb.sexo) return ordemSexo(pa.sexo) - ordemSexo(pb.sexo)
    const ia = ORDEM_TAMANHOS.indexOf(pa.base)
    const ib = ORDEM_TAMANHOS.indexOf(pb.base)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return pa.base.localeCompare(pb.base, 'pt-BR', { numeric: true })
  })
}

/** Total de pares de uma grade (soma de todos os tamanhos). */
export const totalDaGrade = (grade: Grade | null | undefined): number =>
  Object.values(grade ?? {}).reduce((a, b) => a + (Number(b) || 0), 0)

/** Só o que precisamos de uma ficha para contar peças. */
export type FichaContagem = Pick<FichaTecnica, 'pedido_id' | 'grade'>

/**
 * pedido.id → total de peças, somando as grades de TODAS as fichas do pedido.
 * Um pedido pode ter várias modelagens (manga curta + manga longa, por
 * exemplo), e cada uma tem a sua grade.
 */
export function pecasPorPedido(fichas: FichaContagem[]): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const f of fichas) {
    mapa.set(f.pedido_id, (mapa.get(f.pedido_id) ?? 0) + totalDaGrade(f.grade))
  }
  return mapa
}

/** Soma as peças de uma lista de pedidos, usando o mapa acima. */
export const somarPecas = (
  pedidos: { id: string }[],
  porPedido: Map<string, number>,
): number => pedidos.reduce((total, p) => total + (porPedido.get(p.id) ?? 0), 0)

/** Grade em linhas ordenadas, pronta para exibir/imprimir. */
export function gradeEmLinhas(grade: Grade | null | undefined): { tamanho: string; qtd: number }[] {
  const g = grade ?? {}
  return ordenarTamanhos(Object.keys(g))
    .map((t) => ({ tamanho: t, qtd: Number(g[t]) || 0 }))
    .filter((l) => l.qtd > 0)
}

/** Uma modelagem agrupada no mapa de corte. */
export interface GrupoCorte {
  /**
   * Chave estável do grupo, usada para gravar o progresso do corte.
   * Não muda conforme as peças que caem no lote — ao contrário do rótulo.
   */
  chave: string
  /** rótulo exibido (ex.: "Gola redonda / V", "Shorts") */
  modelagem: string
  /** grade somada de todas as fichas do grupo */
  grade: Grade
  /** total de pares */
  total: number
  /**
   * Quantas peças de cada tamanho são manga longa. O corpo da camisa é o
   * mesmo, então manga curta e longa cortam juntas — mas quem corta precisa
   * saber quantas mangas longas tirar.
   */
  mangaLonga: Grade
  /** total de peças de manga longa no grupo */
  totalMangaLonga: number
  /** fichas que compõem o grupo (para abrir a ficha completa) */
  fichas: FichaTecnica[]
  /** id do anexo de Layout de Corte da primeira ficha que tiver um */
  layoutAnexoId: string | null
  /** true quando NENHUMA ficha do grupo tem Layout de Corte definido */
  semLayout: boolean
}

/**
 * Lê as partes cortadas de um tamanho, aceitando os formatos antigos:
 * lotes anteriores gravavam só `true` (tamanho inteiro pronto) e, por um
 * período, as chaves `frente`/`costa`.
 */
export const partesDoTamanho = (
  v: boolean | Partial<PartesCorte & { frente: boolean; costa: boolean }> | undefined | null,
): PartesCorte => {
  if (typeof v === 'object' && v !== null) {
    return {
      camisa: Boolean(v.camisa ?? v.frente),
      manga: Boolean(v.manga ?? v.costa),
    }
  }
  return { camisa: Boolean(v), manga: Boolean(v) }
}

/** O tamanho só está cortado quando camisa E manga foram feitas. */
export const tamanhoCortado = (
  v: boolean | Partial<PartesCorte & { frente: boolean; costa: boolean }> | undefined | null,
): boolean => {
  const p = partesDoTamanho(v)
  return p.camisa && p.manga
}

/** Uma especificação de corte do grupo (tecido, gola, punho…) */
export interface EspecCorte {
  rotulo: string
  /** valores distintos entre as fichas do grupo; mais de um = elas divergem */
  valores: { valor: string; pedidos: number[] }[]
  /** true quando as fichas do grupo não combinam neste campo */
  divergente: boolean
}

/**
 * Punho interessa só como sim/não para o corte. A ficha escreve de várias
 * formas ("SIM (LONGA)", "RIBANA", "NÃO"), então reduz para os dois casos.
 */
const punhoSimNao = (v: string) => (/^(n[ãa]o|sem\b|nenhum|0|-)/i.test(v.trim()) ? 'Não' : 'Sim')

/**
 * Campos da ficha que o corte precisa conhecer, na ordem de leitura.
 * O modelo da manga fica de fora daqui porque tem coluna própria na grade
 * (o corpo é o mesmo; muda só quantas mangas compridas sair).
 */
const CAMPOS_CORTE: [string, keyof FichaTecnica, ((v: string) => string)?][] = [
  ['Tecido', 'tecido'],
  ['Gola', 'gola'],
  ['Punho', 'punho', punhoSimNao],
  ['Estampa', 'estampa'],
]

/**
 * Campos onde valores diferentes são normais e NÃO devem virar alerta.
 * A gola é quem forma o grupo: redonda e V caem juntas de propósito, então
 * marcá-las como divergentes seria alarme falso. Os valores continuam
 * listados com o número do pedido, que é o que a cortadeira precisa ver.
 */
const CAMPOS_SEM_ALERTA = new Set<keyof FichaTecnica>(['gola'])

/**
 * Especificações de corte de um grupo.
 *
 * Um grupo junta fichas de pedidos diferentes com a mesma modelagem — e elas
 * podem ter tecido ou gola distintos. Em vez de mostrar só o primeiro valor
 * (o que levaria a cortar no tecido errado), devolve TODOS os valores com os
 * pedidos de cada um, marcando quando divergem.
 */
export function especificacoesDoGrupo(grupo: GrupoCorte): EspecCorte[] {
  const especs: EspecCorte[] = []

  for (const [rotulo, campo, normalizar] of CAMPOS_CORTE) {
    const porValor = new Map<string, number[]>()
    for (const f of grupo.fichas) {
      const bruto = String(f[campo] ?? '').trim()
      if (!bruto) continue
      const valor = normalizar ? normalizar(bruto) : bruto
      const chave = normalizar ? valor : valor.toUpperCase()
      const pedidos = porValor.get(chave) ?? []
      const numero = f.pedido?.numero
      if (typeof numero === 'number' && !pedidos.includes(numero)) pedidos.push(numero)
      porValor.set(chave, pedidos)
    }
    if (porValor.size === 0) continue
    especs.push({
      rotulo,
      valores: [...porValor.entries()].map(([valor, pedidos]) => ({ valor, pedidos })),
      divergente: porValor.size > 1 && !CAMPOS_SEM_ALERTA.has(campo),
    })
  }

  return especs
}

/** Observações das fichas do grupo, sem repetir texto igual. */
export function observacoesDoGrupo(grupo: GrupoCorte): { texto: string; pedidos: number[] }[] {
  const porTexto = new Map<string, number[]>()
  for (const f of grupo.fichas) {
    const texto = String(f.observacoes ?? '').trim()
    if (!texto) continue
    const pedidos = porTexto.get(texto) ?? []
    const numero = f.pedido?.numero
    if (typeof numero === 'number' && !pedidos.includes(numero)) pedidos.push(numero)
    porTexto.set(texto, pedidos)
  }
  return [...porTexto.entries()].map(([texto, pedidos]) => ({ texto, pedidos }))
}

// ------------------------------------------------------------
// Como o corte agrupa as fichas
//
// Na mesa de corte o que importa é a MODELAGEM, não o pedido e não a cor:
// fichas de pedidos diferentes com a mesma modelagem são cortadas juntas,
// somando as grades.
//
// Para camisa, quem define a modelagem é a GOLA. Redonda e V são o mesmo
// corpo — só o acabamento do pescoço muda —, então entram no mesmo grupo.
// Polo, pesca e as demais têm corpo próprio e ficam cada uma no seu.
//
// A manga NÃO separa: manga curta e manga longa saem do mesmo corpo. Elas
// somam no mesmo grupo, e o grupo guarda quantas são longas para quem corta
// saber quantas mangas compridas tirar.
// ------------------------------------------------------------

/** Peças que não são camisa e por isso não seguem a regra da gola. */
const PECAS_DE_BAIXO = /SHORTS?|CAL[ÇC][AÃ]O|BERMUDA/i

/**
 * Famílias de gola, da mais específica para a mais genérica. A ordem
 * importa: "polo" e "pesca" precisam ser testadas antes de redonda/V.
 */
const FAMILIAS_GOLA: [RegExp, string][] = [
  [/POLO/i, 'Gola polo'],
  [/PESCA|PADRE/i, 'Gola pesca'],
  [/OL[ÍI]MPIC/i, 'Gola olímpica'],
  [/CARECA|REDOND|CAREC|\bGOLA\s*O\b/i, 'Gola redonda / V'],
  [/\bV\b|DECOTE\s*V/i, 'Gola redonda / V'],
]

/** Manga longa aparece ora no campo da manga, ora no nome da modelagem. */
const ehMangaLonga = (f: FichaTecnica): boolean =>
  /LONGA/i.test(`${f.manga ?? ''} ${f.modelagem ?? ''}`)

/**
 * Em que grupo de corte a ficha entra.
 * Devolve a chave (estável, usada para gravar o progresso) e o rótulo.
 */
export function familiaDeCorte(f: FichaTecnica): { chave: string; rotulo: string } {
  const modelagem = String(f.modelagem ?? '').trim()

  // shorts, calção e bermuda cortam juntos, venham do pedido que vierem
  if (PECAS_DE_BAIXO.test(modelagem)) return { chave: 'BAIXO', rotulo: 'Shorts' }

  const gola = String(f.gola ?? '').trim()
  if (gola) {
    for (const [re, rotulo] of FAMILIAS_GOLA) {
      if (re.test(gola)) return { chave: rotulo.toUpperCase(), rotulo }
    }
    // gola que não conhecemos vira grupo próprio, com o nome como está na ficha
    return { chave: `GOLA ${gola.toUpperCase()}`, rotulo: `Gola ${gola.toLowerCase()}` }
  }

  // sem gola informada não dá para saber a modelagem: mantém a peça isolada,
  // que é o comportamento seguro — juntar errado estraga o corte
  const nome = modelagem || 'Sem modelagem'
  return { chave: nome.toUpperCase(), rotulo: nome }
}

/**
 * Agrupa as fichas para o corte e soma as grades de tamanhos.
 * Ex.: dois pedidos de gola redonda e um de gola V viram um bloco só.
 */
export function agruparParaCorte(fichas: FichaTecnica[]): GrupoCorte[] {
  const mapa = new Map<string, GrupoCorte>()
  for (const f of fichas) {
    const { chave, rotulo } = familiaDeCorte(f)
    if (!chave) continue
    const grupo =
      mapa.get(chave) ??
      ({
        chave,
        modelagem: rotulo,
        grade: {},
        total: 0,
        mangaLonga: {},
        totalMangaLonga: 0,
        fichas: [],
        layoutAnexoId: null,
        semLayout: true,
      } satisfies GrupoCorte)
    const longa = ehMangaLonga(f)
    for (const [tam, qtd] of Object.entries(f.grade ?? {})) {
      const n = Number(qtd) || 0
      if (n <= 0) continue
      const t = tam.trim().toUpperCase()
      grupo.grade[t] = (grupo.grade[t] ?? 0) + n
      if (longa) grupo.mangaLonga[t] = (grupo.mangaLonga[t] ?? 0) + n
    }
    grupo.fichas.push(f)
    if (!grupo.layoutAnexoId && f.layout_anexo_id) {
      grupo.layoutAnexoId = f.layout_anexo_id
      grupo.semLayout = false
    }
    mapa.set(chave, grupo)
  }
  for (const g of mapa.values()) {
    g.total = totalDaGrade(g.grade)
    g.totalMangaLonga = totalDaGrade(g.mangaLonga)
  }
  return [...mapa.values()].sort((a, b) => a.modelagem.localeCompare(b.modelagem, 'pt-BR'))
}
