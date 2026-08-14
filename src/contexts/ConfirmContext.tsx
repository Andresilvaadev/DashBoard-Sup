import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Substitui o `confirm()` do navegador por um diálogo com a cara do sistema.
 *
 * Uso:
 *   const confirmar = useConfirm()
 *   if (!(await confirmar({ mensagem: 'Excluir o pedido 601?' }))) return
 *
 * A promessa resolve `true` no botão de confirmar e `false` ao cancelar,
 * apertar Esc ou clicar fora — igual ao comportamento nativo.
 */
export interface OpcoesConfirmacao {
  /** título curto; quando ausente, usa "Confirmar" */
  titulo?: string
  /** o que será feito, em uma ou duas frases */
  mensagem: string
  /** texto do botão que confirma (padrão: "Confirmar") */
  textoConfirmar?: string
  /** texto do botão que cancela (padrão: "Cancelar") */
  textoCancelar?: string
  /** ação destrutiva: pinta o botão de vermelho */
  perigo?: boolean
}

type Resolver = (ok: boolean) => void

const Ctx = createContext<(opts: OpcoesConfirmacao) => Promise<boolean>>(async () => false)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<OpcoesConfirmacao | null>(null)
  const resolverRef = useRef<Resolver | null>(null)
  const botaoRef = useRef<HTMLButtonElement>(null)

  const confirmar = useCallback((opts: OpcoesConfirmacao) => {
    setPedido(opts)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const responder = useCallback((ok: boolean) => {
    setPedido(null)
    resolverRef.current?.(ok)
    resolverRef.current = null
  }, [])

  // Esc cancela, Enter confirma — como no diálogo do navegador
  useEffect(() => {
    if (!pedido) return
    botaoRef.current?.focus()
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        responder(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        responder(true)
      }
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [pedido, responder])

  return (
    <Ctx.Provider value={confirmar}>
      {children}

      {pedido && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm md:items-center"
          onClick={() => responder(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-slate-100">{pedido.titulo ?? 'Confirmar'}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{pedido.mensagem}</p>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => responder(false)}
                className="flex-1 rounded-xl border border-slate-700 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800"
              >
                {pedido.textoCancelar ?? 'Cancelar'}
              </button>
              <button
                ref={botaoRef}
                onClick={() => responder(true)}
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-colors ${
                  pedido.perigo ? 'bg-rose-600 hover:bg-rose-500' : 'bg-red-600 hover:bg-red-500'
                }`}
              >
                {pedido.textoConfirmar ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

export const useConfirm = () => useContext(Ctx)
