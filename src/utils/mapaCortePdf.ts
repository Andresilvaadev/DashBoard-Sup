import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Grade } from '../types'
import type { GrupoCorte } from './corte'
import { especificacoesDoGrupo, gradeEmLinhas } from './corte'

/** Baixa a imagem e converte para dataURL (jsPDF não aceita URL remota). */
async function imagemParaDataUrl(url: string): Promise<{ dados: string; formato: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const dados = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => reject(new Error('falha ao ler imagem'))
      fr.readAsDataURL(blob)
    })
    const formato = blob.type.includes('png') ? 'PNG' : 'JPEG'
    return { dados, formato }
  } catch {
    return null // imagem indisponível: o PDF sai sem ela
  }
}

export interface DadosMapaCorte {
  lote: string
  responsavel: string
  pedidos: string
  grupos: GrupoCorte[]
  /** id do anexo → URL da imagem do layout */
  urlsLayout: Record<string, string>
}

/**
 * Gera o PDF do Mapa de Corte: cabeçalho do lote, cada modelagem com a
 * grade somada, o total de pares, a miniatura do Layout de Corte e as
 * observações das fichas.
 */
export async function gerarPdfMapaCorte(d: DadosMapaCorte) {
  const doc = new jsPDF()
  const larguraPagina = doc.internal.pageSize.getWidth()
  const alturaPagina = doc.internal.pageSize.getHeight()

  doc.setFontSize(16)
  doc.text('Mapa de Corte', 14, 18)
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`Lote ${d.lote}  •  ${new Date().toLocaleString('pt-BR')}`, 14, 25)
  doc.text(`Responsável: ${d.responsavel || '—'}`, 14, 31)
  doc.text(doc.splitTextToSize(`Pedidos: ${d.pedidos}`, larguraPagina - 28), 14, 37)

  let y = 48
  for (const g of d.grupos) {
    // quebra de página quando não couber o bloco
    if (y > alturaPagina - 70) {
      doc.addPage()
      y = 20
    }

    doc.setFontSize(13)
    doc.setTextColor(20)
    doc.text(g.modelagem.toUpperCase(), 14, y)
    doc.setFontSize(10)
    doc.setTextColor(90)
    doc.text(`Total: ${g.total} pares`, larguraPagina - 14, y, { align: 'right' })

    // Especificações do corte (tecido, gola, punho…) logo abaixo do título:
    // é o que a cortadeira precisa conferir antes de cortar.
    const especs = especificacoesDoGrupo(g)
    if (especs.length > 0) {
      y += 5
      doc.setFontSize(9)
      doc.setTextColor(40)
      const linha = especs
        .map((e) => {
          const valores = e.valores
            .map((v) =>
              e.divergente && v.pedidos.length > 0
                ? `${v.valor} (#${v.pedidos.join(', #')})`
                : v.valor,
            )
            .join(' · ')
          return `${e.rotulo}: ${valores}${e.divergente ? ' [DIFERENTE]' : ''}`
        })
        .join('    ')
      const linhasEspec = doc.splitTextToSize(linha, larguraPagina - 28) as string[]
      doc.text(linhasEspec, 14, y)
      y += linhasEspec.length * 4.5 - 3
    }

    // Manga longa e punho só entram quando o grupo tem: são peças cortadas à
    // parte, e quem está na mesa precisa saber quantas tirar de cada tamanho.
    const extras: { titulo: string; grade: Grade; total: number }[] = []
    if (g.totalMangaLonga > 0)
      extras.push({ titulo: 'M. longa', grade: g.mangaLonga, total: g.totalMangaLonga })
    if (g.totalComPunho > 0)
      extras.push({ titulo: 'Punho', grade: g.comPunho, total: g.totalComPunho })

    autoTable(doc, {
      startY: y + 3,
      head: [['Tamanho', 'Pares', ...extras.map((e) => e.titulo)]],
      body: gradeEmLinhas(g.grade).map((l) => [
        l.tamanho,
        String(l.qtd),
        ...extras.map((e) => (e.grade[l.tamanho] ? String(e.grade[l.tamanho]) : '—')),
      ]),
      foot: [['Total', String(g.total), ...extras.map((e) => String(e.total))]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [11, 18, 51] },
      footStyles: { fillColor: [11, 18, 51], fontStyle: 'bold' },
      margin: { left: 14, right: larguraPagina / 2 },
      tableWidth: larguraPagina / 2 - 20,
    })
    const fimTabela = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

    // imagem do layout de corte, à direita da tabela
    let fimImagem = y
    const urlLayout = g.layoutAnexoId ? d.urlsLayout[g.layoutAnexoId] : undefined
    if (urlLayout) {
      const img = await imagemParaDataUrl(urlLayout)
      if (img) {
        const larg = 70
        const alt = 50
        try {
          doc.addImage(img.dados, img.formato, larguraPagina / 2 + 5, y + 3, larg, alt)
          fimImagem = y + 3 + alt
        } catch {
          /* imagem inválida: segue sem ela */
        }
      }
    } else {
      doc.setFontSize(9)
      doc.setTextColor(180, 80, 0)
      doc.text('Sem Layout de Corte definido', larguraPagina / 2 + 5, y + 10)
      doc.setTextColor(90)
    }

    y = Math.max(fimTabela, fimImagem) + 6

    // observações das fichas do grupo
    const obs = g.fichas
      .filter((f) => f.observacoes?.trim())
      .map((f) => `#${f.pedido?.numero ?? ''}: ${f.observacoes.trim()}`)
    if (obs.length > 0) {
      doc.setFontSize(9)
      doc.setTextColor(90)
      const linhas = doc.splitTextToSize(`Obs.: ${obs.join(' | ')}`, larguraPagina - 28)
      doc.text(linhas, 14, y)
      y += linhas.length * 4 + 2
    }

    doc.setDrawColor(200)
    doc.line(14, y, larguraPagina - 14, y)
    y += 8
  }

  doc.save(`mapa-corte-${d.lote}.pdf`)
}
