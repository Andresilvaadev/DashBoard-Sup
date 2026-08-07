import BarraProgresso from './BarraProgresso'
import LinhaDoTempo from './LinhaDoTempo'
import type { PedidoPublico } from '../lib/consulta'
import { data, dataHora, diasAte, tempoRelativo } from '../lib/formato'

/** Selo de status, com o texto que faz sentido para o cliente */
function Selo({ pedido }: { pedido: PedidoPublico }) {
  const mapa = {
    concluido: { texto: '✓ Pedido concluído', cor: 'bg-emerald-500/15 text-emerald-400' },
    arquivado: { texto: '✓ Pedido concluído', cor: 'bg-emerald-500/15 text-emerald-400' },
    cancelado: { texto: 'Pedido cancelado', cor: 'bg-slate-700/60 text-slate-300' },
    em_andamento: { texto: 'Em produção', cor: 'bg-sky-500/15 text-sky-300' },
  } as const
  const s = mapa[pedido.status] ?? mapa.em_andamento
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${s.cor}`}>{s.texto}</span>
}

/** Uma informação do cabeçalho (rótulo + valor) */
function Info({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-200">
        {valor}
        {destaque && <span className="ml-1.5 text-xs font-normal text-slate-500">{destaque}</span>}
      </dd>
    </div>
  )
}

export default function ResultadoPedido({
  pedido,
  onNovaConsulta,
  atualizadoAgora,
}: {
  pedido: PedidoPublico
  onNovaConsulta: () => void
  /** momento da última verificação automática, para mostrar que está ao vivo */
  atualizadoAgora: Date
}) {
  const concluido = pedido.status === 'concluido' || pedido.status === 'arquivado'
  const total = pedido.total_etapas ?? pedido.etapas.length
  const percentual = concluido
    ? 100
    : total > 0 && pedido.etapa_ordem != null
      ? Math.round(((pedido.etapa_ordem - 1) / total) * 100)
      : 0

  const dias = diasAte(pedido.previsao_entrega)
  const previsaoDestaque =
    dias == null || concluido
      ? undefined
      : dias < 0
        ? `(${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'dia' : 'dias'} de atraso)`
        : dias === 0
          ? '(é hoje)'
          : `(faltam ${dias} ${dias === 1 ? 'dia' : 'dias'})`

  return (
    <div className="surgir space-y-7">
      {/* cabeçalho */}
      <header>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xl font-bold">
            Pedido <span className="text-red-500">#{pedido.numero}</span>
          </p>
          <Selo pedido={pedido} />
        </div>
        <p className="mt-1 text-sm text-slate-400">{pedido.cliente}</p>
      </header>

      {/* etapa atual em destaque */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
        <p className="text-xs text-slate-500">Etapa atual</p>
        <p className="mt-0.5 text-lg font-semibold text-sky-300">
          {concluido ? 'Finalizado' : (pedido.etapa_atual ?? '—')}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Atualizado em {dataHora(pedido.atualizado_em)} • {tempoRelativo(pedido.atualizado_em)}
        </p>
      </div>

      <BarraProgresso
        etapas={pedido.etapas}
        ordemAtual={concluido ? total + 1 : pedido.etapa_ordem}
        percentual={percentual}
      />

      {/* informações principais */}
      <dl className="grid grid-cols-2 gap-4 border-t border-slate-800 pt-5">
        <Info rotulo="Data do pedido" valor={data(pedido.criado_em)} />
        <Info
          rotulo={concluido ? 'Concluído em' : 'Previsão de entrega'}
          valor={concluido ? data(pedido.concluido_em) : data(pedido.previsao_entrega)}
          destaque={previsaoDestaque}
        />
      </dl>

      <div className="border-t border-slate-800 pt-5">
        <LinhaDoTempo movimentos={pedido.timeline} />
      </div>

      <footer className="border-t border-slate-800 pt-5">
        <button
          onClick={onNovaConsulta}
          className="w-full rounded-xl border border-slate-700 py-3 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800"
        >
          Consultar outro pedido
        </button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-slate-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Atualiza sozinho • última verificação às{' '}
          {atualizadoAgora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </footer>
    </div>
  )
}
