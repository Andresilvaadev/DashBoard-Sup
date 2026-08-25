import type { FichaTecnica, Grade } from '../types'

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
  /** nome normalizado para exibição (ex.: "Manga Curta") */
  modelagem: string
  /** grade somada de todas as fichas dessa modelagem */
  grade: Grade
  /** total de pares */
  total: number
  /** fichas que compõem o grupo (para abrir a ficha completa) */
  fichas: FichaTecnica[]
  /** id do anexo de Layout de Corte da primeira ficha que tiver um */
  layoutAnexoId: string | null
  /** true quando NENHUMA ficha do grupo tem Layout de Corte definido */
  semLayout: boolean
}

const chaveModelagem = (m: string) => m.trim().toLowerCase()

/**
 * Agrupa as fichas por modelagem e soma as grades de tamanhos.
 * Ex.: 3 pedidos com "Manga Curta" viram um único bloco com a soma dos tamanhos.
 */
export function agruparPorModelagem(fichas: FichaTecnica[]): GrupoCorte[] {
  const mapa = new Map<string, GrupoCorte>()
  for (const f of fichas) {
    const chave = chaveModelagem(f.modelagem)
    if (!chave) continue
    const grupo =
      mapa.get(chave) ??
      ({
        modelagem: f.modelagem.trim(),
        grade: {},
        total: 0,
        fichas: [],
        layoutAnexoId: null,
        semLayout: true,
      } satisfies GrupoCorte)
    for (const [tam, qtd] of Object.entries(f.grade ?? {})) {
      const n = Number(qtd) || 0
      if (n <= 0) continue
      const t = tam.trim().toUpperCase()
      grupo.grade[t] = (grupo.grade[t] ?? 0) + n
    }
    grupo.fichas.push(f)
    if (!grupo.layoutAnexoId && f.layout_anexo_id) {
      grupo.layoutAnexoId = f.layout_anexo_id
      grupo.semLayout = false
    }
    mapa.set(chave, grupo)
  }
  for (const g of mapa.values()) g.total = totalDaGrade(g.grade)
  return [...mapa.values()].sort((a, b) => a.modelagem.localeCompare(b.modelagem, 'pt-BR'))
}
