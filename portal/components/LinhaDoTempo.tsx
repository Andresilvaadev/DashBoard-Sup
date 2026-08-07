import type { MovimentoPublico } from '../lib/consulta'
import { dataHora, tempoRelativo } from '../lib/formato'

/**
 * Linha do tempo do pedido: cada movimentação registrada pela produção.
 * Mostra apenas a etapa e o momento — nada de funcionário responsável
 * ou observações internas.
 */
export default function LinhaDoTempo({ movimentos }: { movimentos: MovimentoPublico[] }) {
  if (movimentos.length === 0) return null

  // mais recente primeiro
  const ordenados = [...movimentos].reverse()

  return (
    <section aria-label="Histórico do pedido">
      <h2 className="mb-3 text-sm font-semibold text-slate-300">Histórico</h2>
      <ol className="relative space-y-4 border-l border-slate-800 pl-5">
        {ordenados.map((m, i) => (
          <li key={`${m.data}-${i}`} className="relative">
            <span
              className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-slate-900"
              style={{ background: i === 0 ? '#38bdf8' : (m.cor ?? '#46538f') }}
            />
            <p className={`text-sm font-medium ${i === 0 ? 'text-sky-300' : 'text-slate-300'}`}>
              {m.etapa}
            </p>
            <p className="text-xs text-slate-500">
              {dataHora(m.data)}
              <span className="ml-1 text-slate-600">• {tempoRelativo(m.data)}</span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
