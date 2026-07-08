import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabaseConfigurado } from '../lib/supabase'

export default function Login() {
  const { session, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  if (session) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    const msg = await signIn(email, senha)
    setEnviando(false)
    if (msg) setErro(msg === 'Invalid login credentials' ? 'E-mail ou senha inválidos.' : msg)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/icon-512.png" alt="Supreme" className="mx-auto h-20 w-20 rounded-full" />
          <h1 className="mt-4 text-3xl font-bold uppercase tracking-widest">Supreme</h1>
          <p className="mt-1 text-sm text-slate-400">Dashboard de produção — acesso restrito</p>
        </div>

        {!supabaseConfigurado && (
          <div className="mb-4 rounded-lg border border-amber-700 bg-amber-950/50 p-3 text-xs text-amber-300">
            ⚠️ Supabase não configurado. Copie <code>.env.example</code> para <code>.env</code>,
            preencha as chaves do seu projeto e execute <code>supabase/schema.sql</code> no SQL Editor.
          </div>
        )}

        <form onSubmit={submit} className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <label className="block text-xs font-medium text-slate-400">E-mail</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500"
            placeholder="voce@empresa.com"
          />
          <label className="mt-4 block text-xs font-medium text-slate-400">Senha</label>
          <input
            type="password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500"
            placeholder="••••••••"
          />
          {erro && <p className="mt-3 text-sm text-rose-400">{erro}</p>}
          <button
            type="submit"
            disabled={enviando}
            className="mt-5 w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-600">
          Contas são criadas pelo administrador.
        </p>
      </div>
    </div>
  )
}
