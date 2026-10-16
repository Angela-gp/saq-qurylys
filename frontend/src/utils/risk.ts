export type Zone = 'green' | 'yellow' | 'red'
export function zoneFor(score: number, hasR1: boolean, hasR2: boolean): Zone {
  if (score >= 60 && hasR1 && hasR2) return 'red'
  if (score >= 25) return 'yellow'
  return 'green'
}
