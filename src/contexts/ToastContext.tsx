import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Tipo = 'sucesso' | 'erro' | 'info'
interface Toast {
  id: number
  tipo: Tipo
  msg: string
}

const Ctx = createContext<(msg: string, tipo?: Tipo) => void>(() => {})

const cores: Record<Tipo, string> = {
  sucesso: 'bg-emerald-600',
  erro: 'bg-rose-600',
  info: 'bg-sky-600',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((msg: string, tipo: Tipo = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, tipo, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-[100] flex w-[92%] max-w-md -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`${cores[t.tipo]} rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
