import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'
import { useEtapas } from '../hooks/useEtapas'
import { ABAS } from '../lib/abas'
import {
  interpretarComando,
  interpretarComandoEstoque,
  type ComandoEstoque,
  type ComandoVoz,
  type ItemEstoqueVoz,
} from '../utils/voz'

type Modo = 'pedidos' | 'estoque'

type Fase = 'ocioso' | 'gravando' | 'confirmando' | 'salvando' | 'digitando'

/** Mensagens amigáveis para os códigos de erro da Web Speech API */
const MENSAGENS_ERRO: Record<string, string> = {
  network:
    'Seu navegador bloqueia o reconhecimento de voz (comum no Brave e Firefox). Use Chrome ou Edge, ou digite o comando.',
  'not-allowed': 'Permissão do microfone negada. Libere o microfone nas configurações do site.',
  'service-not-allowed': 'O serviço de voz está bloqueado neste navegador. Use Chrome ou Edge, ou digite o comando.',
  'audio-capture': 'Nenhum microfone encontrado. Verifique se há um microfone conectado.',
  'language-not-supported': 'Português não é suportado pelo reconhecedor deste navegador.',
}

/**
 * Botão flutuante de comando: reconhece frases como "1234 corte" ou
 * "pedido 1234 foi para costura" e move o pedido. Se a interpretação não
 * for confiável, pede confirmação. Onde a voz não funciona (Brave/Firefox),
 * oferece digitação do mesmo comando.
 */
export default function VoiceButton() {
  const toast = useToast()
  const { pathname } = useLocation()
  const { etapasDoFluxo } = useEtapas()
  const [fase, setFase] = useState<Fase>('ocioso')
  const [comando, setComando] = useState<ComandoVoz | null>(null)
  const [comandoEstoque, setComandoEstoque] = useState<ComandoEstoque | null>(null)
  const [textoManual, setTextoManual] = useState('')
  const [suportado, setSuportado] = useState(true)
  const recRef = useRef<SpeechRecognition | null>(null)

  // qual aba de pedidos está aberta (pela rota), se houver
  const abaAtual = pathname.startsWith('/criacao')
    ? ABAS.find((a) => a.tipo === 'criacao')
    : pathname.startsWith('/canecas')
      ? ABAS.find((a) => a.tipo === 'caneca')
      : pathname.startsWith('/pedidos')
        ? ABAS.find((a) => a.tipo === 'pronto')
        : undefined

  // o microfone só aparece (e age) nas telas em que é usado
  const modo: Modo | null = pathname.startsWith('/estoque')
    ? 'estoque'
    : abaAtual
      ? 'pedidos'
      : null

  // refs estáveis para uso dentro dos callbacks do reconhecedor
  // (cada aba usa as etapas do seu próprio fluxo)
  const etapasDaRota = abaAtual ? etapasDoFluxo(abaAtual.fluxo) : []
  const etapasRef = useRef(etapasDaRota)
  etapasRef.current = etapasDaRota
  const modoRef = useRef(modo)
  modoRef.current = modo
  const toastRef = useRef(toast)
  toastRef.current = toast

  useEffect(() => {
    const Ctor =
      (typeof SpeechRecognition !== 'undefined' && SpeechRecognition) ||
      (typeof webkitSpeechRecognition !== 'undefined' && webkitSpeechRecognition)
    if (!Ctor) {
      setSuportado(false)
      return
    }
    const rec = new Ctor()
    rec.lang = 'pt-BR'
    rec.continuous = false
    rec.interimResults = false
    rec.maxAlternatives = 1

    rec.onresult = (ev) => {
      const alt = ev.results[0]?.[0]
      if (!alt) return
      void processar(alt.transcript, alt.confidence ?? 0)
    }
    rec.onerror = (ev) => {
      if (ev.error === 'aborted') {
        setFase('ocioso')
        return
      }
      if (ev.error === 'no-speech') {
        setFase('ocioso')
        toastRef.current('Não ouvi nada. Tente de novo perto do microfone.', 'info')
        return
      }
      const msg = MENSAGENS_ERRO[ev.error] ?? `Erro no reconhecimento de voz (${ev.error}).`
      toastRef.current(msg, 'erro')
      // navegador bloqueou o serviço -> abre a digitação como alternativa
      if (ev.error === 'network' || ev.error === 'service-not-allowed') {
        setFase('digitando')
      } else {
        setFase('ocioso')
      }
    }
    rec.onend = () => {
      setFase((f) => (f === 'gravando' ? 'ocioso' : f))
    }
    recRef.current = rec
    return () => rec.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Interpreta o texto (falado ou digitado) e salva ou pede confirmação */
  async function processar(texto: string, confidence: number) {
    if (modoRef.current === 'estoque') {
      // busca os itens atuais e interpreta a baixa
      const { data } = await supabase.from('estoque_itens').select('id, nome, quantidade')
      const cmd = interpretarComandoEstoque(texto, confidence, (data as ItemEstoqueVoz[]) ?? [])
      setComando(null)
      setComandoEstoque(cmd)
      if (!cmd.item) {
        setFase('ocioso')
        toastRef.current('Não entendi qual item. Diga por ex.: "usei um dry fit titânio".', 'info')
        return
      }
      if (cmd.confiavel) void aplicarEstoque(cmd)
      else setFase('confirmando')
      return
    }

    // pedidos
    const cmd = interpretarComando(texto, confidence, etapasRef.current)
    setComandoEstoque(null)
    setComando(cmd)
    if (!cmd.numero || !cmd.etapa) {
      setFase('ocioso')
      return
    }
    if (cmd.confiavel) {
      void salvar(cmd)
    } else {
      setFase('confirmando')
    }
  }

  async function aplicarEstoque(cmd: ComandoEstoque) {
    if (!cmd.item) return
    setFase('salvando')
    const delta = cmd.operacao === 'adicionar' ? cmd.quantidade : -cmd.quantidade
    const { data, error } = await supabase.rpc('ajustar_estoque', {
      p_item_id: cmd.item.id,
      p_delta: delta,
    })
    setFase('ocioso')
    setComandoEstoque(null)
    if (error) {
      toastRef.current(error.message, 'erro')
    } else {
      const verbo = cmd.operacao === 'adicionar' ? 'entrada de' : 'baixa de'
      toastRef.current(`${cmd.item.nome}: ${verbo} ${cmd.quantidade} (agora ${Number(data)})`, 'sucesso')
    }
  }

  async function salvar(cmd: ComandoVoz) {
    if (!cmd.numero || !cmd.etapa) return
    setFase('salvando')
    const { data, error } = await supabase.rpc('mover_pedido', {
      p_numero: cmd.numero,
      p_etapa_id: cmd.etapa.id,
      p_observacao: `Comando: "${cmd.transcricao}"`,
      p_via_voz: true,
    })
    setFase('ocioso')
    setComando(null)
    if (error) {
      toastRef.current(error.message, 'erro')
    } else {
      const r = data as { pedido: number; etapa: string }
      toastRef.current(`Pedido ${r.pedido} → ${r.etapa}`, 'sucesso')
    }
  }

  function aoClicar() {
    // navegador sem suporte OU Brave (que bloqueia o serviço): vai direto p/ digitação
    const navegadorBrave = Boolean((navigator as unknown as { brave?: unknown }).brave)
    if (!recRef.current || navegadorBrave) {
      if (navegadorBrave && fase === 'ocioso') {
        toastRef.current('O Brave bloqueia o reconhecimento de voz — digite o comando (ou use Chrome/Edge).', 'info')
      }
      setFase((f) => (f === 'digitando' ? 'ocioso' : 'digitando'))
      return
    }
    if (fase === 'gravando') {
      recRef.current.stop()
      setFase('ocioso')
    } else if (fase === 'ocioso') {
      setComando(null)
      setComandoEstoque(null)
      try {
        recRef.current.start()
        setFase('gravando')
      } catch {
        /* já iniciado */
      }
    }
  }

  function enviarManual(e: FormEvent) {
    e.preventDefault()
    const texto = textoManual.trim()
    if (!texto) return
    setTextoManual('')
    // digitado tem confiança máxima, mas ainda confirma se faltar número/etapa
    void processar(texto, 1)
  }

  // fora de Pedidos e Estoque o microfone não aparece
  if (!modo) return null

  const exemplo = modo === 'estoque' ? 'usei um dry fit titânio' : '1234 corte'
  const exemplo2 =
    modo === 'estoque' ? 'comprei cinco dry fit titânio' : 'pedido 1234 foi para costura'

  return (
    <>
      <button
        onClick={aoClicar}
        aria-label="Comando de voz"
        className={`fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition-colors md:bottom-6 md:right-6 ${
          fase === 'gravando'
            ? 'mic-gravando bg-rose-600 text-white'
            : 'bg-red-600 text-white hover:bg-red-500'
        }`}
      >
        {fase === 'salvando' ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : suportado ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
            <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
            <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
          </svg>
        )}
      </button>

      {fase === 'gravando' && (
        <div className="fixed bottom-36 right-4 z-50 rounded-lg bg-slate-800 px-4 py-2 text-sm shadow-lg md:bottom-24 md:right-6">
          <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500 align-middle" />
          Ouvindo… fale por ex. <span className="font-semibold">"{exemplo}"</span>
        </div>
      )}

      {comando && fase === 'ocioso' && (!comando.numero || !comando.etapa) && (
        <div className="fixed bottom-36 right-4 z-50 max-w-xs rounded-lg bg-amber-700 px-4 py-2 text-sm shadow-lg md:bottom-24 md:right-6">
          Não entendi "{comando.transcricao}".
          {!comando.numero && ' Diga o número do pedido.'}
          {!comando.etapa && ' Diga a etapa.'}
          <button onClick={() => setComando(null)} className="ml-2 font-bold underline">
            ok
          </button>
        </div>
      )}

      {/* Digitação manual: alternativa quando a voz não funciona */}
      {fase === 'digitando' && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-4 md:items-center"
          onClick={() => setFase('ocioso')}
        >
          <form
            onSubmit={enviarManual}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
          >
            <p className="text-sm font-semibold">Digite o comando</p>
            <p className="mt-1 text-xs text-slate-500">
              Ex.: <span className="font-medium text-slate-300">{exemplo}</span> ou{' '}
              <span className="font-medium text-slate-300">{exemplo2}</span>
            </p>
            <input
              autoFocus
              value={textoManual}
              onChange={(e) => setTextoManual(e.target.value)}
              placeholder={exemplo}
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500"
            />
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setFase('ocioso')}
                className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm font-medium hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500"
              >
                Executar
              </button>
            </div>
          </form>
        </div>
      )}

      {fase === 'confirmando' && comando && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-4 md:items-center">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <p className="text-sm text-slate-400">Você disse:</p>
            <p className="mt-1 italic text-slate-300">"{comando.transcricao}"</p>
            <p className="mt-4 text-lg font-semibold">
              Mover pedido <span className="text-red-400">{comando.numero}</span> para{' '}
              <span style={{ color: comando.etapa?.cor }}>{comando.etapa?.nome}</span>?
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => {
                  setFase('ocioso')
                  setComando(null)
                }}
                className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm font-medium hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={() => void salvar(comando)}
                className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação da baixa de estoque */}
      {fase === 'confirmando' && comandoEstoque?.item && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-4 md:items-center">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <p className="text-sm text-slate-400">Você disse:</p>
            <p className="mt-1 italic text-slate-300">"{comandoEstoque.transcricao}"</p>
            <p className="mt-4 text-lg font-semibold">
              {comandoEstoque.operacao === 'adicionar' ? 'Adicionar' : 'Dar baixa de'}{' '}
              <span className="text-red-400">{comandoEstoque.quantidade}</span> em{' '}
              <span className="text-violet-300">{comandoEstoque.item.nome}</span>?
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Em estoque agora: {comandoEstoque.item.quantidadeAtual} →{' '}
              {comandoEstoque.operacao === 'adicionar' ? 'ficará' : 'restará'}{' '}
              {comandoEstoque.operacao === 'adicionar'
                ? comandoEstoque.item.quantidadeAtual + comandoEstoque.quantidade
                : Math.max(0, comandoEstoque.item.quantidadeAtual - comandoEstoque.quantidade)}
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => {
                  setFase('ocioso')
                  setComandoEstoque(null)
                }}
                className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm font-medium hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={() => void aplicarEstoque(comandoEstoque)}
                className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                {comandoEstoque.operacao === 'adicionar' ? 'Confirmar entrada' : 'Confirmar baixa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
