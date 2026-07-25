import { memo, type ReactNode } from 'react'

// memo: os cards aparecem em grades grandes — só re-renderizam quando as
// próprias props mudam, não a cada render da página
export default memo(function StatCard({
  titulo,
  valor,
  detalhe,
  icone,
  cor = 'text-red-400',
}: {
  titulo: string
  valor: ReactNode
  detalhe?: string
  icone?: ReactNode
  cor?: string
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{titulo}</p>
        {icone && <span className={cor}>{icone}</span>}
      </div>
      <p className={`mt-2 text-2xl font-bold ${cor}`}>{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-slate-500">{detalhe}</p>}
    </div>
  )
})
