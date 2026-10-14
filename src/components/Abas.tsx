/**
 * Abas de assunto dentro de uma tela.
 *
 * Quebra em linhas no celular em vez de rolar para o lado: rolando, a
 * última aba aparece cortada na borda e parece defeito. É um controle de
 * navegação, não um filtro — por isso a moldura segmentada, diferente das
 * pílulas soltas usadas nos filtros.
 */
export default function Abas<T extends string>({
  abas,
  ativa,
  onMudar,
  rotulo = 'Seções da tela',
}: {
  abas: { id: T; label: string; contador?: number }[]
  ativa: T
  onMudar: (id: T) => void
  rotulo?: string
}) {
  // No celular as abas viram grade: 4 abas ficam 2 em cima e 2 embaixo, 5 ou 6
  // ficam 3 por linha. Em linha única sobrava uma aba sozinha embaixo, o que
  // parecia defeito. A última estica para fechar a linha quando sobra espaço.
  const colunas = abas.length <= 2 ? abas.length : abas.length === 5 || abas.length % 3 === 0 ? 3 : 2
  const resto = abas.length % colunas

  return (
    <div
      role="tablist"
      aria-label={rotulo}
      style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` }}
      className="grid gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1 sm:flex sm:flex-wrap"
    >
      {abas.map((a, i) => {
        const selecionada = a.id === ativa
        const ultimaSobrando = resto !== 0 && i === abas.length - 1
        return (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={selecionada}
            onClick={() => onMudar(a.id)}
            style={ultimaSobrando ? { gridColumn: `span ${colunas - resto + 1}` } : undefined}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-xs font-bold transition-colors sm:min-w-[5.5rem] sm:px-3 ${
              selecionada
                ? 'bg-red-600 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {a.label}
            {a.contador != null && a.contador > 0 && (
              <span
                className={`rounded-full px-1.5 text-[10px] font-black leading-4 tabular-nums ${
                  selecionada ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {a.contador}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
