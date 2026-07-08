import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function Protected({ children, somenteAdmin = false }: { children: ReactNode; somenteAdmin?: boolean }) {
  const { session, profile, loading, isAdmin } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (profile && !profile.ativo) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center text-slate-400">
        Sua conta está desativada. Fale com o administrador.
      </div>
    )
  }
  if (somenteAdmin && !isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}
