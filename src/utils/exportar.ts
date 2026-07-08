import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'

export interface TabelaExport {
  titulo: string
  colunas: string[]
  linhas: (string | number)[][]
}

export function exportarPDF(nomeArquivo: string, periodo: string, tabelas: TabelaExport[]) {
  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.text('Relatório de Produção', 14, 18)
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`Período: ${periodo}  •  Gerado em ${new Date().toLocaleString('pt-BR')}`, 14, 25)

  let y = 32
  for (const t of tabelas) {
    doc.setFontSize(12)
    doc.setTextColor(30)
    doc.text(t.titulo, 14, y)
    autoTable(doc, {
      startY: y + 3,
      head: [t.colunas],
      body: t.linhas,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] },
      margin: { left: 14, right: 14 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12
    if (y > 260) {
      doc.addPage()
      y = 20
    }
  }
  doc.save(`${nomeArquivo}.pdf`)
}

export function exportarExcel(nomeArquivo: string, tabelas: TabelaExport[]) {
  const wb = XLSX.utils.book_new()
  for (const t of tabelas) {
    const ws = XLSX.utils.aoa_to_sheet([[t.titulo], [], t.colunas, ...t.linhas])
    // nome de aba: máx 31 caracteres, sem caracteres inválidos
    const aba = t.titulo.replace(/[\\/?*[\]:]/g, '').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, aba)
  }
  XLSX.writeFile(wb, `${nomeArquivo}.xlsx`)
}
