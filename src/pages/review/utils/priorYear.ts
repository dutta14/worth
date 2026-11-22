import { type DeltaKind, formatDelta } from './format'

/** "vs. 2024: up $5,000". Null when either side is unavailable, so nothing is shown. */
export function describePriorYear(
  priorYear: number,
  current: number | null,
  prior: number | null | undefined,
  kind: DeltaKind,
): string | null {
  if (current === null || prior === null || prior === undefined) return null
  const delta = formatDelta(current - prior, kind)
  return `vs. ${priorYear}: ${delta.charAt(0).toLowerCase()}${delta.slice(1)}`
}
