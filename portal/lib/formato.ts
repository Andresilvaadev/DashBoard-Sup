/** Formatações de data usadas no portal (pt-BR). */

export function dataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function data(iso: string | null | undefined): string {
  if (!iso) return '—'
  // datas puras (aaaa-mm-dd) seriam lidas como UTC; força o fuso local
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return d.toLocaleDateString('pt-BR')
}

/** "há 2 dias", "há 3 horas", "agora mesmo" */
export function tempoRelativo(iso: string | null | undefined): string {
  if (!iso) return ''
  const seg = (Date.now() - new Date(iso).getTime()) / 1000
  if (seg < 60) return 'agora mesmo'
  const min = Math.floor(seg / 60)
  if (min < 60) return `há ${min} ${min === 1 ? 'minuto' : 'minutos'}`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`
  const d = Math.floor(h / 24)
  if (d < 30) return `há ${d} ${d === 1 ? 'dia' : 'dias'}`
  const m = Math.floor(d / 30)
  return `há ${m} ${m === 1 ? 'mês' : 'meses'}`
}

/** Dias que faltam para a entrega (negativo = atrasado) */
export function diasAte(dataISO: string | null | undefined): number | null {
  if (!dataISO) return null
  const alvo = new Date(`${dataISO}T00:00:00`)
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000)
}
