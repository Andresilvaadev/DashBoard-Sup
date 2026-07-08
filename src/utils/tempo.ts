/** Formata segundos em texto legível: "2d 3h", "4h 12min", "35min", "50s" */
export function formatarDuracao(segundos: number | null | undefined): string {
  if (segundos == null || segundos < 0) return '—'
  if (segundos < 60) return `${Math.round(segundos)}s`
  const min = Math.floor(segundos / 60)
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  const restoMin = min % 60
  if (h < 24) return restoMin > 0 ? `${h}h ${restoMin}min` : `${h}h`
  const d = Math.floor(h / 24)
  const restoH = h % 24
  return restoH > 0 ? `${d}d ${restoH}h` : `${d}d`
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '—'
  // datas puras (yyyy-mm-dd) são interpretadas como UTC; força horário local
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso)
  return d.toLocaleDateString('pt-BR')
}

export function hojeISO(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function segundosDesde(iso: string): number {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
}
