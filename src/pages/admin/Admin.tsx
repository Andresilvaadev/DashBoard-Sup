import { NavLink, Outlet } from 'react-router-dom'

const abas = [
  { to: '/admin', label: 'Funcionários', end: true },
  { to: '/admin/fluxo', label: 'Fluxo de produção' },
  { to: '/admin/metas', label: 'Metas diárias' },
  { to: '/admin/sistema', label: 'Sistema' },
]

export default function Admin() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">Administração</h1>
        <p className="text-sm text-slate-400">Gerencie funcionários, fluxo e metas</p>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {abas.map((a) => (
          <NavLink
            key={a.to}
            to={a.to}
            end={a.end}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-full px-4 py-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-red-600 text-white'
                  : 'border border-slate-700 text-slate-400 hover:bg-slate-800'
              }`
            }
          >
            {a.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  )
}
