import { memo, type ReactNode } from 'react'

/**
 * Uma célula de número dentro de um painel.
 *
 * Não é um cartão: quem separa são fios de 1px do próprio painel. Cartão
 * dentro de cartão era o que deixava o resumo parecendo um amontoado.
 */
export default memo(function Celula({
  rotulo,
  valor,
  detalhe,
  cor = 'text-slate-100',
  /** nome de pessoa ou setor: texto, não número — não pede corpo gigante */
  texto = false,
}: {
  rotulo: string
  valor: ReactNode
  detalhe?: string
  cor?: string
  texto?: boolean
}) {
  return (
    <div className="bg-slate-900 p-3.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{rotulo}</p>
      <p
        className={`mt-1 font-black leading-tight ${
          texto ? 'text-base' : 'text-2xl tabular-nums'
        } ${cor}`}
      >
        {valor}
      </p>
      {detalhe && <p className="mt-1 text-[11px] leading-snug text-slate-500">{detalhe}</p>}
    </div>
  )
})
