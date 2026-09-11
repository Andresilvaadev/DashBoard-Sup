import type { FichaTecnica, PartesCorte } from '../types'
import {
  especificacoesDoGrupo,
  gradeEmLinhas,
  observacoesDoGrupo,
  partesDoTamanho,
  tamanhoCortado,
  type GrupoCorte,
} from '../utils/corte'

type ValorProgresso = boolean | Partial<PartesCorte> | null | undefined

/**
 * Um bloco do Mapa de Corte: uma modelagem com a grade somada dos pedidos.
 *
 * Desenhado para o celular, que é onde a cortadeira usa: cada tamanho vira
 * um cartão (em vez de uma tabela de até cinco colunas, que espremia no
 * telefone) e os botões de marcar têm altura de dedo, não de mouse.
 */
export default function GrupoCorteCard({
  grupo: g,
  progresso,
  comLote,
  urlLayout,
  onAlternarParte,
  onAbrirFicha,
}: {
  grupo: GrupoCorte
  /** progresso deste grupo no lote: { "M MASC": { camisa, manga } } */
  progresso?: Record<string, ValorProgresso> | null
  /** há lote aberto? sem lote, não há o que marcar */
  comLote: boolean
  urlLayout?: string
  onAlternarParte: (tamanho: string, campo: keyof PartesCorte) => void
  onAbrirFicha: (f: FichaTecnica) => void
}) {
  const linhas = gradeEmLinhas(g.grade)
  const feitos = linhas.filter((l) => tamanhoCortado(progresso?.[l.tamanho], g.partes)).length
  const completo = comLote && linhas.length > 0 && feitos === linhas.length
  const pedidosDoGrupo = [...new Set(g.fichas.map((f) => f.pedido?.numero).filter(Boolean))]
  const especs = especificacoesDoGrupo(g)
  const obs = observacoesDoGrupo(g)

  return (
    <section
      className={`overflow-hidden rounded-2xl border bg-slate-900 ${
        completo ? 'border-emerald-700/70' : 'border-slate-800'
      }`}
    >
      {/* ---- cabeçalho: nome da modelagem e o total, que é o que se procura primeiro ---- */}
      <header className="border-b border-slate-800 bg-gradient-to-br from-slate-800/70 to-slate-900 px-4 py-3.5 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Modelagem</p>
            <h2 className="text-lg font-extrabold uppercase leading-tight tracking-wide sm:text-xl">
              {g.modelagem}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {pedidosDoGrupo.length} pedido(s) · {linhas.length} tamanho(s)
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-4xl font-black leading-none tabular-nums text-emerald-400">{g.total}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">peças</p>
          </div>
        </div>

        {(comLote || g.totalMangaLonga > 0 || g.totalComPunho > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {comLote && (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  completo ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {completo ? '✓ Tudo cortado' : `${feitos}/${linhas.length} cortados`}
              </span>
            )}
            {g.totalMangaLonga > 0 && (
              <span
                title="Do total, quantas peças levam manga longa"
                className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-300 ring-1 ring-amber-500/40"
              >
                {g.totalMangaLonga} manga longa
              </span>
            )}
            {g.totalComPunho > 0 && (
              <span
                title="Do total, quantas peças levam punho"
                className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-bold text-sky-300 ring-1 ring-sky-500/40"
              >
                {g.totalComPunho} com punho
              </span>
            )}
          </div>
        )}

        {comLote && linhas.length > 0 && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${(feitos / linhas.length) * 100}%` }}
            />
          </div>
        )}
      </header>

      {/* ---- especificações: o que a cortadeira confere antes de encostar na tesoura ---- */}
      {especs.length > 0 && (
        <div className="grid grid-cols-2 gap-2 border-b border-slate-800 px-4 py-3 sm:grid-cols-4 sm:px-5">
          {especs.map((e) => (
            <div
              key={e.rotulo}
              className={`min-w-0 rounded-xl border px-3 py-2 ${
                e.divergente ? 'border-amber-600/60 bg-amber-950/30' : 'border-slate-800 bg-slate-950/50'
              }`}
            >
              <p className="flex flex-wrap items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {e.rotulo}
                {e.divergente && (
                  <span
                    title="As fichas deste grupo têm valores diferentes — confira antes de cortar junto"
                    className="rounded-full bg-amber-500 px-1.5 py-px text-[9px] font-bold normal-case tracking-normal text-slate-950"
                  >
                    diferente
                  </span>
                )}
              </p>
              <div
                className={`mt-0.5 text-sm font-bold leading-snug ${
                  e.divergente ? 'text-amber-200' : 'text-slate-100'
                }`}
              >
                {e.valores.map((v) => (
                  <p key={v.valor}>
                    {v.valor}
                    {/* com mais de um valor, diz de qual pedido é cada um */}
                    {e.valores.length > 1 && v.pedidos.length > 0 && (
                      <span className="ml-1 text-[11px] font-medium text-slate-500">
                        #{v.pedidos.join(', #')}
                      </span>
                    )}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {obs.length > 0 && (
        <div className="space-y-1.5 border-b border-slate-800 px-4 py-3 sm:px-5">
          {obs.map((o) => (
            <p
              key={o.texto}
              className="rounded-lg border-l-4 border-amber-500 bg-amber-950/30 px-3 py-2 text-sm leading-snug text-amber-100"
            >
              <span className="mr-1 font-bold text-amber-300">Obs.</span>
              {o.pedidos.length > 0 && (
                <span className="text-xs text-amber-300/70">#{o.pedidos.join(', #')} — </span>
              )}
              {o.texto}
            </p>
          ))}
        </div>
      )}

      {/* ---- tamanhos: um cartão por tamanho, com os botões de marcar ---- */}
      <div className="px-3 py-3 sm:px-5">
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {linhas.map((l) => {
            const partes = partesDoTamanho(progresso?.[l.tamanho])
            const cortado = comLote && g.partes.every((x) => partes[x.campo])
            const longa = g.mangaLonga[l.tamanho] ?? 0
            const punho = g.comPunho[l.tamanho] ?? 0
            return (
              <li
                key={l.tamanho}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                  cortado ? 'border-emerald-700/60 bg-emerald-950/30' : 'border-slate-800 bg-slate-950/50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs font-bold uppercase tracking-wide ${
                      cortado ? 'text-emerald-400 line-through decoration-2' : 'text-slate-400'
                    }`}
                  >
                    {l.tamanho}
                  </p>
                  <p
                    className={`text-2xl font-black leading-tight tabular-nums ${
                      cortado ? 'text-emerald-300/80' : ''
                    }`}
                  >
                    {l.qtd}
                  </p>
                  {(longa > 0 || punho > 0) && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {longa > 0 && (
                        <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-300">
                          {longa} m. longa
                        </span>
                      )}
                      {punho > 0 && (
                        <span className="rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-bold text-sky-300">
                          {punho} punho
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {/* o tamanho só fica pronto quando todas as partes do grupo estão
                    cortadas — camisa tem corpo e manga; shorts sai inteiro */}
                {comLote && (
                  <div className="flex shrink-0 gap-1.5">
                    {g.partes.map(({ campo, rotulo }) => {
                      const feito = partes[campo]
                      return (
                        <button
                          key={campo}
                          type="button"
                          aria-pressed={feito}
                          onClick={() => onAlternarParte(l.tamanho, campo)}
                          title={`${rotulo} do tamanho ${l.tamanho}`}
                          className={`flex h-12 min-w-[4.25rem] flex-col items-center justify-center rounded-lg border px-2 text-[11px] font-bold leading-tight transition-colors active:scale-95 ${
                            feito
                              ? 'border-emerald-500 bg-emerald-600 text-white'
                              : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-emerald-500 hover:text-emerald-300'
                          }`}
                        >
                          <span className="text-base leading-none">{feito ? '✓' : '○'}</span>
                          {rotulo}
                        </button>
                      )
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {/* total do grupo, com o recorte de manga longa e punho */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-slate-950/70 px-3 py-2.5">
          <span className="text-sm font-bold uppercase tracking-wide text-slate-300">Total</span>
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="font-black text-emerald-400">{g.total} peças</span>
            {g.totalMangaLonga > 0 && (
              <span className="font-bold text-amber-300">{g.totalMangaLonga} m. longa</span>
            )}
            {g.totalComPunho > 0 && <span className="font-bold text-sky-300">{g.totalComPunho} punho</span>}
          </span>
        </div>
      </div>

      {/* ---- layout de corte e fichas de origem ---- */}
      <footer className="flex flex-col gap-3 border-t border-slate-800 px-4 py-3 sm:flex-row sm:items-start sm:px-5">
        {urlLayout ? (
          <a href={urlLayout} target="_blank" rel="noreferrer" className="block shrink-0 sm:w-56">
            <img
              src={urlLayout}
              alt={`Layout de corte — ${g.modelagem}`}
              className="max-h-44 w-full rounded-xl border border-slate-700 bg-slate-950 object-contain"
            />
            <p className="mt-1 text-center text-[11px] text-slate-500">Layout de corte · toque para ampliar</p>
          </a>
        ) : (
          <p className="rounded-xl border border-dashed border-amber-800/70 px-3 py-2 text-xs text-amber-400 sm:w-56">
            Sem layout de corte definido nas fichas deste grupo.
          </p>
        )}
        <div className="min-w-0 flex-1">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Fichas de origem
          </p>
          <div className="flex flex-wrap gap-1.5">
            {g.fichas.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onAbrirFicha(f)}
                className="min-h-9 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-red-500 hover:text-red-400"
              >
                Ficha #{f.pedido?.numero ?? '—'}
              </button>
            ))}
          </div>
        </div>
      </footer>
    </section>
  )
}
