import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { criarClienteSignup, supabase } from '../../lib/supabase'
import type { Profile, Role } from '../../types'

export default function Funcionarios() {
  const toast = useToast()
  const { profile: eu } = useAuth()
  const [lista, setLista] = useState<Profile[]>([])
  const [modalNovo, setModalNovo] = useState(false)
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [role, setRole] = useState<Role>('funcionario')
  const [salvando, setSalvando] = useState(false)

  const carregar = async () => {
    const { data } = await supabase.from('profiles').select('*').order('nome')
    setLista((data as Profile[]) ?? [])
  }
  useEffect(() => {
    carregar()
  }, [])

  const criar = async (e: FormEvent) => {
    e.preventDefault()
    setSalvando(true)
    // cliente auxiliar sem persistência: não derruba a sessão do admin
    const { data, error } = await criarClienteSignup().auth.signUp({
      email,
      password: senha,
      options: { data: { nome } },
    })
    if (error || !data.user) {
      setSalvando(false)
      toast(error?.message ?? 'Falha ao criar usuário.', 'erro')
      return
    }
    if (role === 'admin') {
      await supabase.from('profiles').update({ role: 'admin' }).eq('id', data.user.id)
    }
    setSalvando(false)
    setModalNovo(false)
    setNome('')
    setEmail('')
    setSenha('')
    setRole('funcionario')
    toast(`Funcionário ${nome} cadastrado.`, 'sucesso')
    carregar()
  }

  const alternarAtivo = async (p: Profile) => {
    const { error } = await supabase.from('profiles').update({ ativo: !p.ativo }).eq('id', p.id)
    if (error) toast(error.message, 'erro')
    else carregar()
  }

  const alternarRole = async (p: Profile) => {
    const novo = p.role === 'admin' ? 'funcionario' : 'admin'
    const { error } = await supabase.from('profiles').update({ role: novo }).eq('id', p.id)
    if (error) toast(error.message, 'erro')
    else {
      toast(`${p.nome} agora é ${novo === 'admin' ? 'administrador' : 'funcionário'}.`, 'sucesso')
      carregar()
    }
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-red-500'

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setModalNovo(true)}
          className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500"
        >
          + Cadastrar funcionário
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="p-3 font-medium">Nome</th>
              <th className="p-3 font-medium">E-mail</th>
              <th className="p-3 font-medium">Função</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className="border-b border-slate-800/50">
                <td className="p-3 font-medium">
                  {p.nome}
                  {p.id === eu?.id && <span className="ml-2 text-xs text-slate-500">(você)</span>}
                </td>
                <td className="p-3 text-slate-400">{p.email}</td>
                <td className="p-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.role === 'admin' ? 'bg-violet-900 text-violet-300' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {p.role === 'admin' ? 'Admin' : 'Funcionário'}
                  </span>
                </td>
                <td className="p-3">
                  <span className={p.ativo ? 'text-emerald-400' : 'text-rose-400'}>
                    {p.ativo ? '● Ativo' : '○ Inativo'}
                  </span>
                </td>
                <td className="p-3">
                  {p.id !== eu?.id && (
                    <div className="flex gap-3 text-xs">
                      <button onClick={() => void alternarRole(p)} className="text-slate-400 hover:text-violet-400">
                        {p.role === 'admin' ? 'Tornar funcionário' : 'Tornar admin'}
                      </button>
                      <button onClick={() => void alternarAtivo(p)} className="text-slate-400 hover:text-rose-400">
                        {p.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalNovo && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 md:items-center">
          <form
            onSubmit={criar}
            className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
          >
            <h2 className="text-lg font-bold">Cadastrar funcionário</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400">Nome completo *</label>
                <input required value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400">E-mail *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400">Senha inicial * (mín. 6 caracteres)</label>
                <input
                  type="text"
                  required
                  minLength={6}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400">Função</label>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputCls}>
                  <option value="funcionario">Funcionário</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setModalNovo(false)}
                className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm font-medium hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvando}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {salvando ? 'Criando…' : 'Cadastrar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
