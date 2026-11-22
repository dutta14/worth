/** Picks the singular form only when `n === 1`, so zero is plural ("0 rows"). */
export function plural(n: number, one: string, other: string): string {
  return n === 1 ? one : other
}
