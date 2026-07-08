import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import VoiceButton from './VoiceButton'

const iconCls = 'h-5 w-5 shrink-0'
const icones = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconCls}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  pedidos: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconCls}>
      <path d="M9 5h6M9 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h4" />
    </svg>
  ),
  relatorios: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconCls}>
      <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconCls}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
    </svg>
  ),
}

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()

  const links = [
    { to: '/', label: 'Dashboard', icone: icones.dashboard },
    { to: '/pedidos', label: 'Pedidos', icone: icones.pedidos },
    { to: '/relatorios', label: 'Relatórios', icone: icones.relatorios },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icone: icones.admin }] : []),
  ]

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
      isActive ? 'bg-red-600/15 text-red-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
    }`

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-slate-800 bg-slate-900 p-4 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <img src="/icon-192.png" alt="Supreme" className="h-9 w-9 rounded-full" />
          <div>
            <p className="text-sm font-bold uppercase leading-tight tracking-wider">Supreme</p>
            <p className="text-[11px] text-slate-500">Dashboard de produção</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.to === '/'} className={linkCls}>
              {l.icone}
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 pt-3">
          <p className="truncate px-2 text-sm font-medium">{profile?.nome}</p>
          <p className="px-2 text-xs text-slate-500">{isAdmin ? 'Administrador' : 'Funcionário'}</p>
          <button
            onClick={() => void signOut()}
            className="mt-2 w-full rounded-lg px-2 py-2 text-left text-sm text-rose-400 hover:bg-slate-800"
          >
            Sair
          </button>
        </div>
      </aside>

      {/* Conteúdo */}
      <main className="min-w-0 flex-1 pb-20 md:ml-60 md:pb-6">
        {/* Topo (mobile) */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center gap-2">
            <img src="/icon-192.png" alt="Supreme" className="h-7 w-7 rounded-full" />
            <span className="text-sm font-bold uppercase tracking-wider">Supreme</span>
          </div>
          <button onClick={() => void signOut()} className="text-xs text-rose-400">
            Sair
          </button>
        </header>

        <div className="p-4 md:p-6">
          <Outlet />
        </div>
      </main>

      {/* Navegação inferior (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-800 bg-slate-900 md:hidden">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium ${
                isActive ? 'text-red-400' : 'text-slate-500'
              }`
            }
          >
            {l.icone}
            {l.label}
          </NavLink>
        ))}
      </nav>

      <VoiceButton />
    </div>
  )
}
