import { useState, type FormEvent } from 'react'
import { formatarDocumento } from '../lib/consulta'

/** Tela inicial: CPF + número do pedido. É o único jeito de acessar um pedido. */
export default function FormularioConsulta({
  onConsultar,
  carregando,
  erro,
}: {
  onConsultar: (numero: string, cpf: string) => void
  carregando: boolean
  erro: string | null
}) {
  const [numero, setNumero] = useState('')
  const [cpf, setCpf] = useState('')

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    onConsultar(numero, cpf)
  }

  const campo =
    'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-base outline-none transition-colors placeholder:text-slate-600 focus:border-red-500'

  return (
    <form onSubmit={enviar} className="surgir" noValidate>
      <div>
        <label htmlFor="cpf" className="text-sm font-medium text-slate-300">
          CPF <span className="font-normal text-slate-500">ou CNPJ</span>
        </label>
        <input
          id="cpf"
          value={cpf}
          onChange={(e) => setCpf(formatarDocumento(e.target.value))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="000.000.000-00"
          className={campo}
          required
        />
      </div>

      <div className="mt-4">
        <label htmlFor="numero" className="text-sm font-medium text-slate-300">
          Código do pedido
        </label>
        <input
          id="numero"
          value={numero}
          onChange={(e) => setNumero(e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Ex.: 12345"
          className={campo}
          required
        />
      </div>

      {erro && (
        <p role="alert" className="surgir mt-4 rounded-xl bg-red-950/60 px-4 py-3 text-sm text-red-300">
          {erro}
        </p>
      )}

      <button
        type="submit"
        disabled={carregando}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3.5 text-base font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-60"
      >
        {carregando && (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        )}
        {carregando ? 'Consultando…' : 'Consultar Pedido'}
      </button>

      <p className="mt-4 text-center text-xs text-slate-500">
        Informe o CPF (ou CNPJ) usado no pedido e o código que a empresa lhe passou.
      </p>
    </form>
  )
}
