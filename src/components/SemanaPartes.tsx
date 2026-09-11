import { Link } from 'react-router-dom'
import type { Pedido, PlanoSemana, SemanaSetor } from '../types'
import { dataLocal } from '../utils/tempo'

// ============================================================
// Peças visuais da aba Semana. Ficam separadas da página para que a
// página cuide só de dados e ações, e para dar para conferir o visual
// sem precisar do banco.
// ============================================================

export const DIAS_CURTOS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

const doisDigitos = (n: number) => String(n).padStart(2, '0')
/** "Seg" */
export const nomeDia = (d: Date) => DIAS_CURTOS[(d.getDay() + 6) % 7]
/** "08/09" */
export const diaMes = (d: Date) => `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}`
/** "Seg 08/09" */
export const rotuloDia = (d: Date) => `${nomeDia(d)} ${diaMes(d)}`
/** dia gravado no banco ("2026-09-08") como data local */
export const dataDoDia = (dia: string) => new Date(dia + 'T00:00:00')

export interface ContagemDia {
  total: number
  feitas: number
}

// ------------------------------------------------------------
// Faixa de dias: responde "quanto falta em cada dia" num relance
// ------------------------------------------------------------
export function FaixaDias({
  dias,
  ativo,
  visaoSemana,
  hoje,
  contagens,
  onEscolher,
  onSemana,
}: {
  dias: Date[]
  ativo: number
  visaoSemana: boolean
  /** data local de hoje (aaaa-mm-dd) */
  hoje: string
  contagens: ContagemDia[]
  onEscolher: (indice: number) => void
  onSemana: () => void
}) {
  // Com sábado/domingo planejados a faixa chega a 8 colunas, que não cabem
  // em 375px: ela rola para o lado em vez de espremer os botões. O pt-2
  // abre espaço para a etiqueta "hoje", que fica acima do botão.
  return (
    <div className="-mt-2 overflow-x-auto pt-2">
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${dias.length + 1}, minmax(2.6rem, 1fr))` }}
    >
      {dias.map((d, i) => {
        const c = contagens[i] ?? { total: 0, feitas: 0 }
        const faltam = c.total - c.feitas
        const escolhido = !visaoSemana && ativo === i
        const eHoje = dataLocal(d) === hoje
        return (
          <button
            key={dataLocal(d)}
            type="button"
            onClick={() => onEscolher(i)}
            aria-pressed={escolhido}
            aria-label={`${rotuloDia(d)}: ${c.total === 0 ? 'nada planejado' : `${faltam} por fazer de ${c.total}`}`}
            className={`relative flex min-h-[4.5rem] flex-col items-center justify-center rounded-xl border px-1 py-2 transition-colors ${
              escolhido
                ? 'border-red-500 bg-red-600 text-white shadow-lg shadow-red-950/40'
                : eHoje
                  ? 'border-red-500/70 bg-slate-900 text-slate-100'
                  : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
            }`}
          >
            {eHoje && (
              <span className="absolute -top-2 rounded-full bg-red-500 px-1.5 text-[9px] font-black uppercase leading-4 text-white">
                hoje
              </span>
            )}
            <span className="text-xs font-extrabold uppercase">{nomeDia(d)}</span>
            <span className={`text-[10px] ${escolhido ? 'text-red-100' : 'text-slate-500'}`}>{diaMes(d)}</span>
            <span
              className={`mt-1 min-w-[1.5rem] rounded-full px-1.5 text-center text-xs font-black leading-5 ${
                c.total === 0
                  ? escolhido
                    ? 'text-red-100/70'
                    : 'text-slate-600'
                  : faltam === 0
                    ? 'bg-emerald-500 text-white'
                    : escolhido
                      ? 'bg-white text-red-600'
                      : 'bg-red-600 text-white'
              }`}
            >
              {c.total === 0 ? '—' : faltam === 0 ? '✓' : faltam}
            </span>
          </button>
        )
      })}
      <button
        type="button"
        onClick={onSemana}
        aria-pressed={visaoSemana}
        className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 transition-colors ${
          visaoSemana
            ? 'border-red-500 bg-red-600 text-white'
            : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <span className="text-[10px] font-extrabold uppercase">Semana</span>
      </button>
    </div>
    </div>
  )
}

// ------------------------------------------------------------
// Resumo da semana: setores × dias, para quem organiza ver a carga
// ------------------------------------------------------------
export function ResumoSemana({
  dias,
  hoje,
  linhas,
  onAbrir,
}: {
  dias: Date[]
  hoje: string
  linhas: { chave: string; nome: string; cor: string; porDia: ContagemDia[] }[]
  /** toca numa célula: abre aquele dia já filtrado no setor */
  onAbrir: (indiceDia: number, chaveSetor: string) => void
}) {
  // a coluna do setor precisa caber um nome inteiro ("Prensagem") no
  // celular; os dias encolhem até 2,25rem, que ainda é área de toque
  const colunas = `minmax(5.75rem, 1fr) repeat(${dias.length}, minmax(2.25rem, 4.5rem))`
  // Largura mínima da tabela: com 5 dias cabe em 375px; com sábado/domingo
  // não cabe, e aí ela rola para o lado em vez de cortar as últimas colunas.
  const larguraMinima = `${5.75 + dias.length * 2.625 + 1.5}rem`
  const totais = dias.map((_, i) =>
    linhas.reduce(
      (acc, l) => ({ total: acc.total + l.porDia[i].total, feitas: acc.feitas + l.porDia[i].feitas }),
      { total: 0, feitas: 0 },
    ),
  )
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <div className="overflow-x-auto">
      <div style={{ minWidth: larguraMinima }}>
      <div
        className="grid items-end gap-1.5 border-b border-slate-800 px-3 py-2.5"
        style={{ gridTemplateColumns: colunas }}
      >
        <span className="sticky left-0 z-10 bg-slate-900 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Setor
        </span>
        {dias.map((d) => {
          const eHoje = dataLocal(d) === hoje
          return (
            <span
              key={dataLocal(d)}
              className={`text-center text-[10px] font-extrabold uppercase leading-tight ${
                eHoje ? 'text-red-400' : 'text-slate-400'
              }`}
            >
              {nomeDia(d)}
              <span className="block font-normal text-slate-500">{diaMes(d)}</span>
            </span>
          )
        })}
      </div>

      {linhas.map((l) => (
        <div
          key={l.chave}
          className="grid items-center gap-1.5 border-b border-slate-800/60 px-3 py-2"
          style={{ gridTemplateColumns: colunas }}
        >
          <span className="sticky left-0 z-10 flex min-w-0 items-center gap-1.5 bg-slate-900 text-xs font-bold sm:text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.cor }} />
            {/* quebra só entre palavras: "Conferindo e embalando" desce de
                linha, mas "Prensagem" não vira "Prensage / m" */}
            <span className="min-w-0 break-normal [overflow-wrap:normal]">{l.nome}</span>
          </span>
          {l.porDia.map((c, i) => {
            const tudoFeito = c.total > 0 && c.feitas === c.total
            return (
              <button
                key={i}
                type="button"
                disabled={c.total === 0}
                onClick={() => onAbrir(i, l.chave)}
                aria-label={`${l.nome}, ${rotuloDia(dias[i])}: ${c.feitas} de ${c.total} feitas`}
                className={`h-10 rounded-lg text-xs font-extrabold tabular-nums transition-colors ${
                  c.total === 0
                    ? 'text-slate-700'
                    : tudoFeito
                      ? 'bg-emerald-600/25 text-emerald-300 hover:bg-emerald-600/35'
                      : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
                }`}
              >
                {c.total === 0 ? '·' : tudoFeito ? '✓' : `${c.feitas}/${c.total}`}
              </button>
            )
          })}
        </div>
      ))}

      <div className="grid items-center gap-1.5 bg-slate-950 px-3 py-2" style={{ gridTemplateColumns: colunas }}>
        <span className="sticky left-0 z-10 bg-slate-950 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Total
        </span>
        {totais.map((c, i) => (
          <span key={i} className="text-center text-xs font-bold tabular-nums text-slate-300">
            {c.total === 0 ? '—' : `${c.feitas}/${c.total}`}
          </span>
        ))}
      </div>
      </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Cartão de uma tarefa
// ------------------------------------------------------------
export function TarefaCard({
  item,
  pedido,
  foto,
  setor,
  mostrarSetor = false,
  origem,
  podeGerenciar,
  dias,
  onAlternar,
  onMover,
  onExcluir,
}: {
  item: PlanoSemana
  pedido?: Pedido
  foto?: string
  setor?: SemanaSetor | null
  /** mostra a etiqueta do setor (na lista de pendentes, que mistura setores) */
  mostrarSetor?: boolean
  /** "de Seg 08/09" — para tarefa que ficou de outro dia */
  origem?: string
  podeGerenciar: boolean
  /** dias para onde a tarefa pode ser movida */
  dias: Date[]
  onAlternar: () => void
  onMover: (indiceDia: number) => void
  onExcluir: () => void
}) {
  const indiceAtual = dias.findIndex((d) => dataLocal(d) === item.dia)
  const riscado = item.feito ? 'line-through decoration-2 opacity-60' : ''

  return (
    <li
      className={`rounded-xl border p-3 transition-colors ${
        item.feito ? 'border-emerald-800/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-950/50'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* marcar como feita: qualquer funcionário, com área de toque de dedo */}
        <button
          type="button"
          onClick={onAlternar}
          aria-pressed={item.feito}
          aria-label={item.feito ? 'Desmarcar tarefa' : 'Marcar tarefa como feita'}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 text-lg font-black transition-colors active:scale-95 ${
            item.feito
              ? 'border-emerald-500 bg-emerald-600 text-white'
              : 'border-slate-600 text-slate-700 hover:border-emerald-500 hover:text-emerald-500'
          }`}
        >
          ✓
        </button>

        <div className="min-w-0 flex-1">
          {pedido && (
            <p className={`leading-snug ${riscado}`}>
              <Link to={`/pedidos/${pedido.numero}`} className="mr-1.5 font-black text-red-400 hover:underline">
                #{pedido.numero}
              </Link>
              <span className="font-semibold text-slate-100">{pedido.cliente}</span>
            </p>
          )}
          {item.texto && (
            <p
              className={`leading-snug ${
                pedido ? 'mt-0.5 text-sm text-slate-300' : 'text-base font-semibold text-slate-100'
              } ${riscado}`}
            >
              {item.texto}
            </p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {origem && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300 ring-1 ring-amber-500/40">
                {origem}
              </span>
            )}
            {mostrarSetor && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{
                  background: `${setor?.cor ?? '#6b77ad'}26`,
                  color: setor?.cor ?? '#9aa3cc',
                }}
              >
                {setor?.nome ?? 'Geral'}
              </span>
            )}
            {pedido &&
              (pedido.status === 'concluido' ? (
                <span className="rounded-full bg-emerald-900 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                  ✓ Pedido concluído
                </span>
              ) : pedido.etapa_atual ? (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: `${pedido.etapa_atual.cor}22`, color: pedido.etapa_atual.cor }}
                >
                  agora em: {pedido.etapa_atual.nome}
                </span>
              ) : null)}
            {pedido && <span className="text-[11px] text-slate-500">{pedido.quantidade} peças</span>}
          </div>
        </div>

        {pedido && foto && (
          <Link to={`/pedidos/${pedido.numero}`} className="shrink-0">
            <img
              src={foto}
              alt={`Foto do pedido ${pedido.numero}`}
              loading="lazy"
              className="h-14 w-14 rounded-lg border border-slate-700 object-cover"
            />
          </Link>
        )}
      </div>

      {/* organizar: só admin/gestor */}
      {podeGerenciar && (
        <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-slate-800/70 pt-2.5">
          <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-500">
            Mover para
            <select
              value={indiceAtual >= 0 ? indiceAtual : ''}
              onChange={(e) => e.target.value !== '' && onMover(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs font-medium text-slate-200 outline-none focus:border-red-500"
            >
              {indiceAtual < 0 && <option value="">escolher dia…</option>}
              {dias.map((d, i) => (
                <option key={dataLocal(d)} value={i}>
                  {rotuloDia(d)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onExcluir}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-800 hover:text-rose-400"
          >
            Remover
          </button>
        </div>
      )}
    </li>
  )
}
