import type { EtapaPublica } from '../lib/consulta'

/**
 * Barra de progresso do pedido.
 * Etapas concluídas: verde • etapa atual: azul (pulsando) • futuras: cinza.
 * As etapas vêm do fluxo real do pedido no banco, então acompanham qualquer
 * mudança que o administrador fizer no Admin → Fluxo.
 */
export default function BarraProgresso({
  etapas,
  ordemAtual,
  percentual,
}: {
  etapas: EtapaPublica[]
  ordemAtual: number | null
  percentual: number
}) {
  if (etapas.length === 0) return null

  return (
    <section aria-label="Progresso do pedido">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-300">Progresso</h2>
        <span className="text-sm font-bold text-emerald-400">{percentual}%</span>
      </div>

      {/* trilho contínuo */}
      <div
        className="h-2.5 overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-valuenow={percentual}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-400 transition-[width] duration-700 ease-out"
          style={{ width: `${percentual}%` }}
        />
      </div>

      {/* etapas: rolagem horizontal no celular, tudo visível no desktop */}
      <ol className="-mx-1 mt-4 flex gap-1 overflow-x-auto pb-2 sm:mx-0 sm:gap-2">
        {etapas.map((e) => {
          const concluida = ordemAtual != null && e.ordem < ordemAtual
          const atual = ordemAtual != null && e.ordem === ordemAtual
          return (
            <li
              key={e.ordem}
              className="flex min-w-[4.5rem] flex-1 shrink-0 flex-col items-center gap-1.5 px-1 text-center"
              aria-current={atual ? 'step' : undefined}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors duration-500 ${
                  concluida
                    ? 'bg-emerald-500 text-slate-950'
                    : atual
                      ? 'etapa-atual bg-sky-400 text-slate-950'
                      : 'bg-slate-800 text-slate-500'
                }`}
              >
                {concluida ? '✓' : e.ordem}
              </span>
              <span
                className={`text-[11px] leading-tight ${
                  atual ? 'font-semibold text-sky-300' : concluida ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {e.nome}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
