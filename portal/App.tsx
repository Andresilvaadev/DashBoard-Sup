import { useCallback, useEffect, useRef, useState } from 'react'
import FormularioConsulta from './components/FormularioConsulta'
import ResultadoPedido from './components/ResultadoPedido'
import { consultarPedido, type PedidoPublico } from './lib/consulta'

/** De quanto em quanto tempo o pedido é reconsultado enquanto a tela está aberta */
const INTERVALO_ATUALIZACAO = 30_000

export default function App() {
  const [pedido, setPedido] = useState<PedidoPublico | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [verificadoEm, setVerificadoEm] = useState(new Date())
  // guarda as credenciais da consulta atual para poder reconsultar sozinho
  const credenciais = useRef<{ numero: string; cpf: string } | null>(null)

  const consultar = async (numero: string, cpf: string) => {
    setCarregando(true)
    setErro(null)
    const { pedido: achado, erro: falha } = await consultarPedido(numero, cpf)
    setCarregando(false)
    if (falha) {
      setErro(falha)
      return
    }
    credenciais.current = { numero, cpf }
    setPedido(achado)
    setVerificadoEm(new Date())
  }

  /** Reconsulta em silêncio: mantém a tela como está se algo falhar */
  const atualizar = useCallback(async () => {
    if (!credenciais.current) return
    const { numero, cpf } = credenciais.current
    const { pedido: atual } = await consultarPedido(numero, cpf)
    if (atual) setPedido(atual)
    setVerificadoEm(new Date())
  }, [])

  // Tempo real: o portal é público (sem login) e, por segurança, o banco não
  // expõe as tabelas para visitantes — então o Realtime do Supabase não pode
  // ser usado aqui. A tela se atualiza sozinha a cada 30s e ao voltar o foco.
  useEffect(() => {
    if (!pedido) return
    const timer = setInterval(() => void atualizar(), INTERVALO_ATUALIZACAO)
    const aoFocar = () => {
      if (document.visibilityState === 'visible') void atualizar()
    }
    document.addEventListener('visibilitychange', aoFocar)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', aoFocar)
    }
  }, [pedido, atualizar])

  const novaConsulta = () => {
    credenciais.current = null
    setPedido(null)
    setErro(null)
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4 py-10">
      <main className="w-full max-w-lg">
        <header className="mb-7 text-center">
          <img src="/icon-192.png" alt="Supreme" className="mx-auto h-14 w-14 rounded-2xl shadow-lg" />
          <h1 className="mt-4 text-2xl font-bold sm:text-3xl">Acompanhe seu pedido</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {pedido
              ? 'Veja abaixo em que etapa está a sua produção.'
              : 'Informe seus dados para ver o andamento em tempo real.'}
          </p>
        </header>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl backdrop-blur sm:p-8">
          {pedido ? (
            <ResultadoPedido
              pedido={pedido}
              onNovaConsulta={novaConsulta}
              atualizadoAgora={verificadoEm}
            />
          ) : (
            <FormularioConsulta onConsultar={consultar} carregando={carregando} erro={erro} />
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Supreme • acompanhamento de produção
        </p>
      </main>
    </div>
  )
}
