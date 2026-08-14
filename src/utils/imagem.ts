/**
 * Prepara imagens antes do upload. Na prática quase nada é alterado: só
 * entra em ação com fotos MUITO grandes, para o upload não travar.
 *
 * - Só mexe em imagens (image/*). PDFs, artes .ai/.psd etc. passam intactos.
 * - Arquivos abaixo do limiar sobem exatamente como estão, sem recodificar.
 * - Se o resultado ficar maior que o original, o original é mantido — o que
 *   costuma acontecer com a qualidade alta usada aqui, preservando a foto.
 */
// Valores altos de propósito: a foto guardada é a que o cliente baixa como
// "original", então a prioridade é qualidade, não economia de espaço.
// O limite de lado só existe para uma foto gigante não travar o upload.
const LADO_MAX = 4000
const QUALIDADE = 0.95
// abaixo disso o arquivo sobe intacto, sem passar pelo canvas
const LIMIAR_BYTES = 4 * 1024 * 1024

export async function comprimirImagem(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  // GIF (pode ser animado) e SVG não passam bem pelo canvas
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file
  if (file.size <= LIMIAR_BYTES) return file

  try {
    const bitmap = await carregarBitmap(file)
    const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height))
    const largura = Math.round(bitmap.width * escala)
    const altura = Math.round(bitmap.height * escala)

    const canvas = document.createElement('canvas')
    canvas.width = largura
    canvas.height = altura
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    // fundo branco: JPEG não tem transparência; evita fundo preto em PNGs
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, largura, altura)
    ctx.drawImage(bitmap, 0, 0, largura, altura)
    if ('close' in bitmap) (bitmap as ImageBitmap).close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALIDADE),
    )
    if (!blob || blob.size >= file.size) return file

    const nome = trocarExtensao(file.name, 'jpg')
    return new File([blob], nome, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    // qualquer falha na compressão: sobe o original sem travar o upload
    return file
  }
}

async function carregarBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return await createImageBitmap(file)
  }
  // fallback para navegadores sem createImageBitmap
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('imagem inválida'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function trocarExtensao(nome: string, ext: string): string {
  return nome.replace(/\.[^.]+$/, '') + '.' + ext
}
