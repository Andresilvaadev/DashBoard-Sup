import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { criarClienteSignup, supabase } from '../../lib/supabase'
import type { Profile, Role } from '../../types'

/** Nome exibido de cada papel */
const ROTULO_ROLE: Record<Role, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  funcionario: 'Funcionário',
}

/** Cor do selo de cada papel */
const COR_ROLE: Record<Role, string> = {
  admin: 'bg-violet-900 text-violet-300',
  gestor: 'bg-sky-900 text-sky-300',
  funcionario: 'bg-slate-800 text-slate-300',
}

/** O que cada papel pode fazer (mostrado na tela para orientar o admin) */
const DESCRICAO_ROLE: Record<Role, string> = {
  admin: 'Acesso total ao sistema.',
  gestor: 'Cria e edita pedidos e fichas técnicas (Pedidos, Criação, Canecas) e monta o Semanal.',
  funcionario: 'Acompanha e move os pedidos de etapa.',
}

/** Traduz os erros do Supabase para algo que o admin entenda e saiba resolver */
function mensagemErroCadastro(msg: string | undefined): string {
  if (!msg) return 'Falha ao criar usuário.'
  if (/rate limit/i.test(msg)) {
    return 'Limite de envio de e-mails do Supabase atingido. Isso só acontece quando o projeto ainda envia e-mail de confirmação — desligue "Confirm email" em Authentication → Providers → Email e aguarde alguns minutos.'
  }
  if (/already registered|already been registered/i.test(msg)) {
    return 'Já existe uma conta com esse e-mail.'
  }
  if (/password/i.test(msg) && /6|short|least/i.test(msg)) {
    return 'A senha precisa ter pelo menos 6 caracteres.'
  }
  if (/invalid.*email|email.*invalid/i.test(msg)) return 'E-mail inválido.'
  return msg
}

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
  /** true quando o Supabase exige confirmação de e-mail (bloqueia o 1º login) */
  const [exigeConfirmacao, setExigeConfirmacao] = useState(false)

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

    // E-mail repetido: o Supabase NÃO devolve erro nesse caso (para não revelar
    // quais e-mails existem) — ele reenvia um e-mail de confirmação, o que
    // consome a cota de envios e leva ao "email rate limit exceeded". Barrar
    // aqui evita o erro e diz o que realmente aconteceu.
    const alvo = email.trim().toLowerCase()
    const { data: jaExiste } = await supabase
      .from('profiles')
      .select('nome')
      .ilike('email', alvo)
      .maybeSingle()
    if (jaExiste) {
      setSalvando(false)
      toast(`Já existe um funcionário com esse e-mail (${jaExiste.nome}).`, 'erro')
      return
    }

    // cliente auxiliar sem persistência: não derruba a sessão do admin
    const { data, error } = await criarClienteSignup().auth.signUp({
      email: alvo,
      password: senha,
      options: { data: { nome } },
    })
    if (error || !data.user) {
      setSalvando(false)
      toast(mensagemErroCadastro(error?.message), 'erro')
      // limite de envio de e-mails: mostra o painel com a orientação
      if (error?.message && /rate limit/i.test(error.message)) setExigeConfirmacao(true)
      return
    }
    if (role !== 'funcionario') {
      await supabase.from('profiles').update({ role }).eq('id', data.user.id)
    }

    // Sem sessão de volta = o projeto exige confirmação de e-mail, e a pessoa
    // não consegue entrar antes de clicar no link. Avisa o admin como resolver.
    const precisaConfirmar = !data.session
    setExigeConfirmacao(precisaConfirmar)

    setSalvando(false)
    setModalNovo(false)
    setNome('')
    setEmail('')
    setSenha('')
    setRole('funcionario')
    toast(
      precisaConfirmar
        ? `${nome} cadastrado, mas precisa confirmar o e-mail para entrar.`
        : `Funcionário ${nome} cadastrado.`,
      precisaConfirmar ? 'info' : 'sucesso',
    )
    carregar()
  }

  const alternarAtivo = async (p: Profile) => {
    const { error } = await supabase.from('profiles').update({ ativo: !p.ativo }).eq('id', p.id)
    if (error) toast(error.message, 'erro')
    else carregar()
  }

  /** Define o papel do usuário (admin / gestor / funcionário) */
  const definirRole = async (p: Profile, novo: Role) => {
    if (p.role === novo) return
    const { error } = await supabase.from('profiles').update({ role: novo }).eq('id', p.id)
    if (error) toast(error.message, 'erro')
    else {
      toast(`${p.nome} agora é ${ROTULO_ROLE[novo].toLowerCase()}.`, 'sucesso')
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

      {/* O projeto exige confirmação de e-mail: explica como liberar o acesso */}
      {exigeConfirmacao && (
        <div className="rounded-xl border border-amber-800 bg-amber-950/40 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-amber-300">
              ⚠️ Este projeto exige confirmação de e-mail
            </p>
            <button
              onClick={() => setExigeConfirmacao(false)}
              className="shrink-0 text-xs text-amber-500 hover:text-amber-300"
            >
              Fechar ✕
            </button>
          </div>
          <p className="mt-2 text-amber-200/80">
            Enquanto essa exigência estiver ligada, cada cadastro dispara um e-mail — e o serviço de
            e-mail embutido do Supabase tem cota baixa, o que causa o erro{' '}
            <em>&quot;email rate limit exceeded&quot;</em>. Desligue a exigência uma única vez:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-amber-200/80">
            <li>
              Abra a página{' '}
              <a
                href="https://supabase.com/dashboard/project/_/auth/providers"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-amber-300 underline"
              >
                Authentication → Providers
              </a>{' '}
              do seu projeto e expanda <strong>Email</strong>
            </li>
            <li>
              Desligue <strong>&quot;Confirm email&quot;</strong> e clique em <strong>Save</strong>
            </li>
            <li>
              Para liberar quem já foi cadastrado, rode no <strong>SQL Editor</strong>:
              <code className="mt-1 block rounded bg-slate-950 px-2 py-1.5 text-xs text-amber-300">
                update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
              </code>
            </li>
          </ol>
        </div>
      )}

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
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COR_ROLE[p.role]}`}>
                    {ROTULO_ROLE[p.role]}
                  </span>
                </td>
                <td className="p-3">
                  <span className={p.ativo ? 'text-emerald-400' : 'text-rose-400'}>
                    {p.ativo ? '● Ativo' : '○ Inativo'}
                  </span>
                </td>
                <td className="p-3">
                  {p.id !== eu?.id && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {p.role !== 'admin' && (
                        <button
                          onClick={() => void definirRole(p, 'admin')}
                          className="text-slate-400 hover:text-violet-400"
                        >
                          Tornar admin
                        </button>
                      )}
                      {p.role !== 'gestor' && (
                        <button
                          onClick={() => void definirRole(p, 'gestor')}
                          title={DESCRICAO_ROLE.gestor}
                          className="text-slate-400 hover:text-sky-400"
                        >
                          Tornar gestor
                        </button>
                      )}
                      {p.role !== 'funcionario' && (
                        <button
                          onClick={() => void definirRole(p, 'funcionario')}
                          className="text-slate-400 hover:text-slate-200"
                        >
                          Tornar funcionário
                        </button>
                      )}
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
                  <option value="gestor">Gestor</option>
                  <option value="admin">Administrador</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">{DESCRICAO_ROLE[role]}</p>
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
