import type { Grade } from '../types'

// ============================================================
// Leitura da FICHA TÉCNICA (modelo Supreme) em PDF ou DOCX.
// Os arquivos são digitais (têm texto), então tudo é lido
// LITERALMENTE — sem OCR, sem IA, sem custo e sem erro de leitura.
//
// Uma ficha pode ter VÁRIAS modelagens (ex.: Manga Curta e Manga
// Longa), cada uma com sua grade. A grade é separada por sexo
// ("M MASC" e "M FEM"), porque no corte são moldes diferentes.
// ============================================================

/** Uma modelagem encontrada na ficha, com sua grade e total de pares. */
export interface ModelagemLida {
  modelagem: string
  grade: Grade
  /** tecido desta peça — shorts e camisa podem ser de tecidos diferentes */
  tecido: string
  total: number
  /** total declarado no cabeçalho (quando existe), para conferência */
  totalDeclarado?: number
}

export interface FichaLida {
  os: string
  data: string
  cliente: string
  tecido: string
  gola: string
  manga: string
  punho: string
  estampa: string
  observacoes: string
  /** uma ou mais modelagens (cada uma vira uma ficha técnica) */
  modelagens: ModelagemLida[]
  /** soma de todas as modelagens */
  total: number
  avisos: string[]
}

const CAMPOS: [RegExp, keyof FichaLida][] = [
  [/N[ºo°]?\s*DA\s*OS\s*:?/i, 'os'],
  [/^DATA\s*:?/i, 'data'],
  [/DADOS\s*DO\s*CLIENTE\s*:?/i, 'cliente'],
  [/TECIDO\s*:?/i, 'tecido'],
  [/MODELO\s*DA\s*GOLA\s*:?/i, 'gola'],
  [/MODELO\s*DA\s*MANGA\s*:?/i, 'manga'],
  [/PUNHO[^:]*:?/i, 'punho'],
  [/TIPO\s*DE\s*ESTAMPA\s*:?/i, 'estampa'],
]

/** identifica um tamanho: PP, P, M, G, GG, XG, 2, 4 AN, 10 ANOS, 2C, BLM... */
export const ehTamanho = (t: string) =>
  /^(PP|P|M|G|GG|XG|XGG|EG|EGG|BL[PMG]|\d{1,2}\s*(AN(OS)?|C)?)$/i.test(t.trim()) && !/^\d{3,}$/.test(t.trim())

const ehNumero = (t: string) => /^\d{1,4}$/.test(t.trim())

/**
 * Peças que NÃO são camisa. Cada uma vira uma modelagem separada, com nome
 * padronizado — assim a grade do shorts nunca é somada à da camisa, mesmo
 * que o título venha escrito de outro jeito ("TAMANHOS SHORT", "GRADE DO
 * SHORT", "SHORT MASC/FEM"…).
 *
 * A ordem importa: o primeiro padrão que casar define o nome.
 */
const PECAS_SEPARADAS: [RegExp, string][] = [
  [/CAL[ÇC][AÃ]O/i, 'Calção'],
  [/SHORTS?/i, 'Shorts'],
  [/BERMUDA/i, 'Bermuda'],
  [/CAL[ÇC]A/i, 'Calça'],
  [/LEGGING/i, 'Legging'],
  [/AGASALHO/i, 'Agasalho'],
  [/JAQUETA/i, 'Jaqueta'],
  [/MOLETOM/i, 'Moletom'],
  [/COLETE/i, 'Colete'],
  [/MACAQUINHO/i, 'Macaquinho'],
  [/SAIA/i, 'Saia'],
  [/BON[ÉE]/i, 'Boné'],
  [/TOUCA/i, 'Touca'],
  [/MEIA/i, 'Meia'],
  [/\bTOPS?\b/i, 'Top'],
]

/** palavras que indicam camisa (a peça padrão da ficha) */
const RE_CAMISA = /MANGA\s+\w+|RAGLAN|CAMISA|CAMISETA|BABY\s*LOOK|REGATA|POLO|UNIFORME/i

/**
 * Título de grade que indica a modelagem.
 *
 * Busca a palavra em QUALQUER posição do texto, não só no começo: fichas
 * costumam escrever "TAMANHOS SHORT" ou "GRADE CAMISA", e exigir que o
 * título começasse pela palavra fazia o título ser descartado — a grade
 * herdava o nome da camisa e as duas peças acabavam somadas.
 */
const ehTituloModelagem = (t: string) => {
  const s = t.trim()
  if (s.length === 0 || s.length >= 40) return false
  return PECAS_SEPARADAS.some(([re]) => re.test(s)) || RE_CAMISA.test(s)
}

/**
 * Títulos que não servem como nome por si só: ou são a peça padrão (camisa),
 * ou são só um cabeçalho de tabela. Nos dois casos o nome vem do modelo da
 * manga, para as tabelas da mesma camisa continuarem sendo somadas.
 */
const ehTituloGenerico = (t: string) => {
  const s = t.trim()
  return (
    /^(CAMISAS?|CAMISETAS?|UNIFORMES?)$/i.test(s) ||
    /^(TAMANHOS?|GRADE|GRADES|MEDIDAS?|QUANTIDADES?)\b/i.test(s)
  )
}

/** "TECIDO: DRY FIT" → "DRY FIT" (usado para o tecido de cada modelagem) */
const tecidoDeTexto = (t: string): string =>
  t.match(/TECIDO[^:]*:\s*(.+)/i)?.[1]?.trim() ?? ''

const normalizaTamanho = (t: string) => t.trim().toUpperCase().replace(/\s+/g, ' ')
const ehInfantil = (t: string) => /AN|C$/i.test(t.trim())

const somaGrade = (g: Grade) => Object.values(g).reduce((a, b) => a + b, 0)

/** Uma grade encontrada no arquivo, antes de virar modelagem */
interface GradeLida {
  titulo: string
  grade: Grade
  /** tecido declarado junto desta grade; vazio = usa o tecido geral da ficha */
  tecido?: string
}

/**
 * Junta as grades lidas em modelagens (grades da MESMA modelagem são somadas —
 * é comum a ficha ter uma tabela INFANTIL e outra ADULTO da mesma camisa) e
 * gera os avisos de conferência contra os totais declarados na ficha.
 */
function montarModelagens(
  ficha: FichaLida,
  lidas: GradeLida[],
  totaisDeclarados: Map<string, number>,
  totalGeralDeclarado: number | null,
) {
  for (const { titulo, grade, tecido } of lidas) {
    if (Object.keys(grade).length === 0) continue
    const nome = nomeModelagem(titulo, ficha.manga)
    const existente = ficha.modelagens.find((m) => m.modelagem === nome)
    if (existente) {
      for (const [tam, qtd] of Object.entries(grade)) {
        existente.grade[tam] = (existente.grade[tam] ?? 0) + qtd
      }
      // a tabela pode trazer o tecido só na segunda parte da mesma modelagem
      if (!existente.tecido && tecido) existente.tecido = tecido
    } else {
      const declarado =
        totaisDeclarados.get(nome.toUpperCase()) ?? totaisDeclarados.get(titulo.toUpperCase())
      ficha.modelagens.push({
        modelagem: nome,
        grade: { ...grade },
        // sem tecido próprio, herda o tecido geral do cabeçalho da ficha
        tecido: tecido || ficha.tecido,
        total: 0,
        totalDeclarado: declarado,
      })
    }
  }

  for (const m of ficha.modelagens) {
    m.total = somaGrade(m.grade)
    if (m.totalDeclarado != null && m.totalDeclarado !== m.total) {
      ficha.avisos.push(
        `"${m.modelagem}": a ficha declara ${m.totalDeclarado} peças, mas a tabela soma ${m.total}. Confira a grade.`,
      )
    }
  }

  ficha.total = ficha.modelagens.reduce((a, m) => a + m.total, 0)

  // conferência final: o TOTAL do cabeçalho tem que bater com tudo que foi lido
  if (totalGeralDeclarado != null && totalGeralDeclarado !== ficha.total) {
    ficha.avisos.push(
      `A ficha declara TOTAL de ${totalGeralDeclarado} peças, mas a leitura somou ${ficha.total}. Confira se alguma tabela de tamanhos ficou de fora.`,
    )
  }
}

/**
 * Nome final da modelagem.
 *
 * Peça que não é camisa (shorts, bermuda…) recebe nome padronizado e nunca
 * cai na regra da manga — é o que impede a grade do shorts de ser somada à
 * da camisa. Título de camisa ou cabeçalho genérico usa o modelo da manga,
 * para as tabelas da MESMA camisa (infantil + adulto) continuarem juntas.
 */
function nomeModelagem(titulo: string, manga: string): string {
  const t = titulo.trim()

  for (const [re, nome] of PECAS_SEPARADAS) {
    if (re.test(t)) return nome
  }

  if (t && !ehTituloGenerico(t)) return t
  const m = manga.trim()
  if (!m) return t || 'Camisa'
  if (/manga/i.test(m)) return m
  return `Manga ${m.charAt(0).toUpperCase()}${m.slice(1).toLowerCase()}`
}

// ============================================================
// DOCX — as grades são tabelas: [tamanho, qtd masc, tamanho, qtd fem]
// ============================================================

const decodifica = (s: string) =>
  s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")

const textoDe = (frag: string) =>
  decodifica([...frag.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('')).trim()

/** recorta blocos <tag>…</tag> respeitando aninhamento */
function blocos(xml: string, tag: string): string[] {
  const abre = `<${tag}>`
  const fecha = `</${tag}>`
  const res: string[] = []
  let i = 0
  while ((i = xml.indexOf(abre, i)) !== -1) {
    let nivel = 0
    let j = i
    while (j < xml.length) {
      const a = xml.indexOf(abre, j)
      const f = xml.indexOf(fecha, j)
      if (f === -1) break
      if (a !== -1 && a < f) {
        nivel++
        j = a + abre.length
      } else {
        nivel--
        j = f + fecha.length
        if (nivel === 0) break
      }
    }
    res.push(xml.slice(i, j))
    i = j
  }
  return res
}

function linhasDaTabela(tbl: string): string[] {
  let corpo = tbl
  for (const aninhada of blocos(tbl.slice(7), 'w:tbl')) corpo = corpo.replace(aninhada, '')
  return [...corpo.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((m) => m[0])
}

async function lerDocx(file: File): Promise<{ tabelas: string[][][]; paragrafos: string[] }> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const doc = zip['word/document.xml']
  if (!doc) throw new Error('Arquivo .docx inválido (sem document.xml)')
  const xml = strFromU8(doc).replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')

  const tabelas = blocos(xml, 'w:tbl').map((t) =>
    linhasDaTabela(t).map((tr) => blocos(tr, 'w:tc').map((tc) => textoDe(tc))),
  )
  const paragrafos = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((m) => textoDe(m[0]))
    .filter(Boolean)
  return { tabelas, paragrafos }
}

function interpretarDocx(tabelas: string[][][], paragrafos: string[]): FichaLida {
  const avisos: string[] = []
  const ficha: FichaLida = {
    os: '', data: '', cliente: '', tecido: '', gola: '', manga: '', punho: '',
    estampa: '', observacoes: '', modelagens: [], total: 0, avisos,
  }
  const totaisDeclarados = new Map<string, number>()
  let totalGeral: number | null = null

  // ---- cabeçalho: células "RÓTULO: VALOR" (em qualquer tabela) + parágrafos ----
  const textos: string[] = [...paragrafos]
  for (const tbl of tabelas) for (const linha of tbl) textos.push(...linha)

  for (const texto of textos) {
    for (const [re, campo] of CAMPOS) {
      if (campo === 'modelagens' || campo === 'total' || campo === 'avisos') continue
      if (ficha[campo]) continue
      const m = texto.match(re)
      if (!m) continue
      const valor = texto.slice(m.index! + m[0].length).replace(/^:\s*/, '').trim()
      if (valor) (ficha[campo] as string) = valor
    }
    // "TOTAL MANGA CURTA: 44" → guarda para conferência
    const tot = texto.match(/TOTAL\s+(.+?)\s*:\s*(\d+)/i)
    if (tot) totaisDeclarados.set(tot[1].trim().toUpperCase(), parseInt(tot[2], 10))
    // "TOTAL: 38" (sem nome) → total geral da ficha
    const totGeral = texto.match(/^TOTAL\s*:\s*(\d+)\s*$/i)
    if (totGeral && totalGeral == null) totalGeral = parseInt(totGeral[1], 10)
    const obs = texto.match(/^OBS\s*:?\s*(.+)/i)
    if (obs && !ficha.observacoes) ficha.observacoes = obs[1].trim()
  }

  // ---- grades: qualquer tabela com pares (tamanho, quantidade) ----
  // Não exige cabeçalho MASCULIN/FEMININ: fichas costumam ter também uma
  // tabela INFANTIL (ou unissex) sem essa divisão, e ela conta igual.
  const lidas: GradeLida[] = []
  for (const tbl of tabelas) {
    const idxCab = tbl.findIndex((l) => l.some((c) => /^MASCULIN/i.test(c)) || l.some((c) => /^FEMININ/i.test(c)))

    // sem cabeçalho de sexo, os dados começam na primeira linha
    const inicioDados = idxCab === -1 ? 0 : idxCab + 1
    // título da grade: linha de célula única antes dos dados
    const titulo =
      tbl.slice(0, Math.max(inicioDados, 1)).map((l) => l.filter(Boolean).join(' ')).find(ehTituloModelagem) ?? ''
    // tecido declarado dentro da própria tabela (o shorts costuma ser de
    // outro tecido que a camisa); vazio = herda o tecido geral da ficha
    const tecidoDaTabela =
      tbl
        .slice(0, Math.max(inicioDados, 1))
        .flat()
        .map(tecidoDeTexto)
        .find(Boolean) ?? ''
    // posição das colunas masculina/feminina na linha de cabeçalho
    const cab = idxCab === -1 ? [] : tbl[idxCab]
    const colMasc = cab.findIndex((c) => /^MASCULIN/i.test(c))
    const colFem = cab.findIndex((c) => /^FEMININ/i.test(c))

    const grade: Grade = {}
    for (const linha of tbl.slice(inicioDados)) {
      for (let i = 0; i < linha.length - 1; i++) {
        const tam = linha[i]?.trim() ?? ''
        const qtdTxt = linha[i + 1]?.trim() ?? ''
        if (!ehTamanho(tam) || !ehNumero(qtdTxt)) continue
        const qtd = parseInt(qtdTxt, 10)
        if (!qtd) continue
        // decide o sexo pela coluna em que o tamanho está
        let sexo = ''
        if (!ehInfantil(tam) && colMasc !== -1 && colFem !== -1) {
          sexo = Math.abs(i - colMasc) <= Math.abs(i - colFem) ? ' MASC' : ' FEM'
        } else if (!ehInfantil(tam) && colMasc !== -1) sexo = ' MASC'
        else if (!ehInfantil(tam) && colFem !== -1) sexo = ' FEM'
        const chave = (normalizaTamanho(tam) + sexo).trim()
        grade[chave] = (grade[chave] ?? 0) + qtd
        i++
      }
    }
    if (Object.keys(grade).length === 0) continue
    lidas.push({ titulo, grade, tecido: tecidoDaTabela })
  }

  montarModelagens(ficha, lidas, totaisDeclarados, totalGeral)
  return ficha
}

// ============================================================
// PDF — o texto tem coordenadas; a grade é reconstruída por linhas
// ============================================================

interface Item {
  texto: string
  x: number
  y: number
}

function emLinhas(itens: Item[]): Item[][] {
  const ordenados = [...itens].sort((a, b) => b.y - a.y || a.x - b.x)
  const linhas: Item[][] = []
  for (const it of ordenados) {
    const linha = linhas.find((l) => Math.abs(l[0].y - it.y) < 3)
    if (linha) linha.push(it)
    else linhas.push([it])
  }
  for (const l of linhas) l.sort((a, b) => a.x - b.x)
  return linhas
}

async function lerPdf(file: File): Promise<Item[]> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const itens: Item[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const pagina = await doc.getPage(p)
    const conteudo = await pagina.getTextContent()
    for (const item of conteudo.items) {
      const it = item as { str?: string; transform?: number[] }
      const texto = (it.str ?? '').trim()
      if (!texto || !it.transform) continue
      itens.push({ texto, x: it.transform[4], y: it.transform[5] - (p - 1) * 10000 })
    }
  }
  await doc.cleanup()
  return itens
}

function interpretarPdf(itens: Item[]): FichaLida {
  const linhas = emLinhas(itens)
  const avisos: string[] = []
  const ficha: FichaLida = {
    os: '', data: '', cliente: '', tecido: '', gola: '', manga: '', punho: '',
    estampa: '', observacoes: '', modelagens: [], total: 0, avisos,
  }
  const totaisDeclarados = new Map<string, number>()
  let totalGeral: number | null = null

  const ehRotulo = (t: string) =>
    CAMPOS.some(([r]) => r.test(t)) || /^(TOTAL|NOME\s*INDIVIDUAL|N[ÚU]MERO\s*INDIVIDUAL|KIT|OBS)/i.test(t)
  const fimDoCabecalho = (t: string) => /^(MASCULIN|FEMININ)/i.test(t) || t.includes(',,')

  // ---- cabeçalho (valores podem continuar na linha seguinte) ----
  for (let li = 0; li < linhas.length; li++) {
    const linha = linhas[li]
    for (let i = 0; i < linha.length; i++) {
      const texto = linha[i].texto
      const tot = texto.match(/TOTAL\s+(.+?)\s*:\s*(\d+)/i)
      if (tot) totaisDeclarados.set(tot[1].trim().toUpperCase(), parseInt(tot[2], 10))
      // "TOTAL: 38" (sem nome) → total geral da ficha
      const totGeral = texto.match(/^TOTAL\s*:\s*(\d+)\s*$/i)
      if (totGeral && totalGeral == null) totalGeral = parseInt(totGeral[1], 10)
      for (const [re, campo] of CAMPOS) {
        if (campo === 'modelagens' || campo === 'total' || campo === 'avisos') continue
        if (ficha[campo]) continue
        const m = texto.match(re)
        if (!m) continue
        let valor = (texto.slice(m.index! + m[0].length).trim() || linha[i + 1]?.texto?.trim() || '')
          .replace(/^:\s*/, '')
        if (!valor || ehRotulo(valor)) continue
        for (let j = li + 1; j < Math.min(li + 3, linhas.length); j++) {
          const seg = linhas[j]
          if (seg.length !== 1) break
          const t = seg[0].texto.trim()
          if (!t || ehRotulo(t) || fimDoCabecalho(t) || ehTamanho(t) || ehTituloModelagem(t)) break
          if (Math.abs(seg[0].x - linha[i].x) > 5) break
          valor += ' ' + t
        }
        ;(ficha[campo] as string) = valor.trim()
      }
    }
  }

  // ---- observações ----
  for (let li = 0; li < linhas.length; li++) {
    const texto = linhas[li].map((x) => x.texto).join(' ')
    const m = texto.match(/OBS\s*:?\s*(.+)/i)
    if (!m) continue
    let obs = m[1].trim()
    for (let j = li + 1; j < Math.min(li + 3, linhas.length); j++) {
      const seg = linhas[j]
      if (seg.length !== 1) break
      const t = seg[0].texto.trim()
      if (!t || ehRotulo(t) || fimDoCabecalho(t) || ehTamanho(t)) break
      obs += ' ' + t
    }
    ficha.observacoes = obs
    break
  }

  // ---- grades: cada título de modelagem inicia um bloco; as colunas
  //      MASCULIN/FEMININ definem o sexo pela posição X ----
  interface Bloco {
    titulo: string
    grade: Grade
    tecido: string
    xMasc: number
    xFem: number
  }
  const blocosGrade: Bloco[] = []
  let atual: Bloco | null = null

  for (const linha of linhas) {
    const textoLinha = linha.map((x) => x.texto).join(' ').trim()
    // título de modelagem sozinho na linha inicia um novo bloco
    if (linha.length === 1 && ehTituloModelagem(textoLinha) && !CAMPOS.some(([r]) => r.test(textoLinha))) {
      atual = { titulo: textoLinha, grade: {}, tecido: '', xMasc: Number.NaN, xFem: Number.NaN }
      blocosGrade.push(atual)
      continue
    }
    // "TECIDO: X" dentro do bloco vale só para aquela modelagem
    if (atual && !atual.tecido) {
      const t = tecidoDeTexto(textoLinha)
      if (t) {
        atual.tecido = t
        continue
      }
    }
    // grade sem título próprio (ex.: tabela INFANTIL): abre um bloco implícito,
    // que depois é somado à modelagem de mesmo nome
    if (!atual && linha.some((it, i) => ehTamanho(it.texto) && ehNumero(linha[i + 1]?.texto ?? ''))) {
      atual = { titulo: '', grade: {}, tecido: '', xMasc: Number.NaN, xFem: Number.NaN }
      blocosGrade.push(atual)
    }
    if (!atual) continue
    for (const it of linha) {
      if (/^MASCULIN/i.test(it.texto)) atual.xMasc = it.x
      if (/^FEMININ/i.test(it.texto)) atual.xFem = it.x
    }
    for (let i = 0; i < linha.length - 1; i++) {
      const tam = linha[i].texto.trim()
      const qtdTxt = linha[i + 1].texto.trim()
      if (!ehTamanho(tam) || !ehNumero(qtdTxt)) continue
      const qtd = parseInt(qtdTxt, 10)
      if (!qtd) continue
      let sexo = ''
      if (!ehInfantil(tam)) {
        const { xMasc, xFem } = atual
        if (!Number.isNaN(xMasc) && !Number.isNaN(xFem)) {
          sexo = Math.abs(linha[i].x - xMasc) <= Math.abs(linha[i].x - xFem) ? ' MASC' : ' FEM'
        } else if (!Number.isNaN(xMasc)) sexo = ' MASC'
        else if (!Number.isNaN(xFem)) sexo = ' FEM'
      }
      const chave = (normalizaTamanho(tam) + sexo).trim()
      atual.grade[chave] = (atual.grade[chave] ?? 0) + qtd
      i++
    }
  }

  montarModelagens(
    ficha,
    blocosGrade.map((b) => ({ titulo: b.titulo, grade: b.grade, tecido: b.tecido })),
    totaisDeclarados,
    totalGeral,
  )
  return ficha
}

// ============================================================
// Entrada única: detecta o formato pelo arquivo
// ============================================================

/** Lê a ficha técnica de um PDF ou DOCX e devolve as modelagens encontradas. */
export async function lerFichaArquivo(file: File): Promise<FichaLida> {
  const nome = file.name.toLowerCase()
  const ehDocx = nome.endsWith('.docx') || file.type.includes('wordprocessingml')
  const ehDoc = nome.endsWith('.doc') && !ehDocx

  if (ehDoc) {
    throw new Error(
      'Arquivos .doc (formato antigo do Word) não são suportados. Abra no Word e salve como .docx ou PDF.',
    )
  }

  const ficha = ehDocx
    ? interpretarDocx(...(await lerDocx(file).then((r) => [r.tabelas, r.paragrafos] as const)))
    : interpretarPdf(await lerPdf(file))

  // OS pelo nome do arquivo quando não vier no conteúdo (ex.: "FICHA ... OS 470 ...")
  if (!ficha.os) {
    const m = file.name.match(/OS\s*[-—]?\s*(\d{1,6})/i)
    if (m) ficha.os = m[1]
  }

  if (ficha.modelagens.length === 0) {
    ficha.avisos.push('Não encontrei nenhuma tabela de tamanhos — preencha a grade manualmente.')
  }
  if (!ficha.manga && ficha.modelagens.length === 0) {
    ficha.avisos.push('Modelo da manga não encontrado — informe a modelagem.')
  }
  return ficha
}
