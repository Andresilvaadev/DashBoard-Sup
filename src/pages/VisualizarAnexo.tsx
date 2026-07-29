import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ehUrlExterna, urlAnexo } from '../lib/anexos'
import { supabase } from '../lib/supabase'
import type { Anexo } from '../types'

/**
 * Visualizador de anexo em aba própria (/anexo/:id).
 *
 * PDFs são desenhados pelo pdf.js dentro da página, em vez de depender do
 * visualizador do navegador — o Brave (e o Chrome com "baixar PDFs" ligado)
 * simplesmente baixa o arquivo e deixa a aba em branco.
 */
export default function VisualizarAnexo() {
  const { id } = useParams()
  const [anexo, setAnexo] = useState<Anexo | null>(null)
  const [url, setUrl] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const paginasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelado = false

    const abrir = async () => {
      const { data } = await supabase.from('anexos').select('*').eq('id', id).maybeSingle()
      const a = data as Anexo | null
      if (cancelado) return
      if (!a) {
        setErro('Anexo não encontrado.')
        setCarregando(false)
        return
      }
      setAnexo(a)
      document.title = a.nome

      const endereco = await urlAnexo(a.path)
      if (cancelado) return
      if (!endereco) {
        setErro('Não foi possível localizar o arquivo no armazenamento.')
        setCarregando(false)
        return
      }
      setUrl(endereco)

      // imagens: o <img> abaixo já resolve
      if (a.tipo.startsWith('image/')) {
        setCarregando(false)
        return
      }

      const ehPdf = /pdf/i.test(a.tipo) || /\.pdf$/i.test(a.nome)
      if (!ehPdf) {
        // Word, Excel e afins não têm como ser exibidos no navegador
        setCarregando(false)
        return
      }

      try {
        const res = await fetch(endereco)
        if (!res.ok) {
          setErro(
            (res.status === 401 || res.status === 403) && ehUrlExterna(a.path)
              ? 'O Cloudinary está bloqueando a entrega de PDFs. No painel do Cloudinary: Settings → Security → desmarque "PDF and ZIP files delivery".'
              : `O arquivo não pôde ser baixado (erro ${res.status}).`,
          )
          setCarregando(false)
          return
        }
        const dados = await res.arrayBuffer()
        if (cancelado) return
        await desenharPdf(dados)
      } catch (e) {
        if (!cancelado) {
          setErro(
            e instanceof Error && /fetch/i.test(e.message)
              ? 'Falha de rede ao baixar o arquivo (verifique a conexão ou as permissões CORS do armazenamento).'
              : `Não foi possível exibir o PDF: ${e instanceof Error ? e.message : 'erro desconhecido'}`,
          )
        }
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }

    /** Renderiza cada página do PDF num canvas */
    const desenharPdf = async (dados: ArrayBuffer) => {
      const pdfjs = await import('pdfjs-dist')
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

      const doc = await pdfjs.getDocument({ data: dados }).promise
      const container = paginasRef.current
      if (!container || cancelado) return
      container.innerHTML = ''

      const larguraAlvo = Math.min(container.clientWidth || 900, 1100)
      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelado) return
        const pagina = await doc.getPage(n)
        const base = pagina.getViewport({ scale: 1 })
        // nitidez em telas retina, sem estourar a memória
        const escala = (larguraAlvo / base.width) * Math.min(window.devicePixelRatio || 1, 2)
        const viewport = pagina.getViewport({ scale: escala })

        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.className = 'mx-auto mb-4 block w-full max-w-[1100px] rounded shadow-lg'
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        container.appendChild(canvas)
        await pagina.render({ canvas, canvasContext: ctx, viewport }).promise
      }
    }

    void abrir()
    return () => {
      cancelado = true
    }
  }, [id])

  const ehImagem = anexo?.tipo.startsWith('image/') ?? false
  const ehPdf = anexo ? /pdf/i.test(anexo.tipo) || /\.pdf$/i.test(anexo.nome) : false

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-200">
      {/* Barra superior */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur">
        <p className="min-w-0 truncate text-sm font-medium">{anexo?.nome ?? 'Anexo'}</p>
        {url && (
          <a
            href={url}
            download={anexo?.nome}
            className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
          >
            Baixar
          </a>
        )}
      </header>

      <main className="p-4">
        {carregando && (
          <div className="flex flex-col items-center gap-3 py-24 text-sm text-slate-500">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
            Carregando arquivo…
          </div>
        )}

        {erro && (
          <div className="mx-auto max-w-lg rounded-xl border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">
            {erro}
            {url && (
              <a href={url} download={anexo?.nome} className="mt-3 block font-semibold text-amber-300 underline">
                Baixar o arquivo mesmo assim
              </a>
            )}
          </div>
        )}

        {!carregando && !erro && ehImagem && (
          <img src={url} alt={anexo?.nome} className="mx-auto max-w-full rounded-lg shadow-lg" />
        )}

        {/* páginas do PDF desenhadas pelo pdf.js */}
        <div ref={paginasRef} className={ehPdf && !erro ? '' : 'hidden'} />

        {!carregando && !erro && !ehImagem && !ehPdf && (
          <div className="mx-auto max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-400">
            <p>
              Este tipo de arquivo ({anexo?.tipo || 'desconhecido'}) não pode ser exibido no
              navegador.
            </p>
            <a
              href={url}
              download={anexo?.nome}
              className="mt-4 inline-block rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500"
            >
              Baixar {anexo?.nome}
            </a>
          </div>
        )}
      </main>
    </div>
  )
}
