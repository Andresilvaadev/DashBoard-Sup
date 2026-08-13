import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Rota da aba que o menu deve manter acesa (Pedidos / Criação / Canecas).
 *
 * O detalhe do pedido vive em /pedidos/:numero para qualquer aba, então sem isso
 * o menu acende "Pedidos" mesmo ao abrir um pedido de Criação ou Canecas. A página
 * de detalhe publica aqui a aba do próprio pedido enquanto está montada.
 */
const Ctx = createContext<{
  aba: string | null
  setAba: (rota: string | null) => void
}>({
  aba: null,
  setAba: () => {},
})

export function AbaAtivaProvider({ children }: { children: ReactNode }) {
  const [aba, setAba] = useState<string | null>(null)
  // memo: setAba do useState já é estável, então o valor só muda quando a aba muda
  const valor = useMemo(() => ({ aba, setAba }), [aba])
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export const useAbaAtiva = () => useContext(Ctx)
