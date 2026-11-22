import type { NormalizedRow } from './types'

/** Lowercases, drops diacritics and collapses whitespace so "CAFÉ  Nero" and "cafe nero" compare equal. */
export function normalizeDescription(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Identity of a transaction for duplicate detection. Category is left out so recategorized rows still match. */
export function dedupeKey(row: Pick<NormalizedRow, 'date' | 'amountCents' | 'description'>): string {
  return `${row.date}|${row.amountCents}|${normalizeDescription(row.description)}`
}

export interface DedupeResult<T> {
  accepted: T[]
  duplicates: T[]
}

/**
 * Splits rows into new and duplicate ones against a multiset of known keys. A key seen n times in the file
 * and k times in `known` accepts max(0, n - k) rows (the earliest ones), so a re-import adds nothing while
 * two identical same-day purchases both import the first time. `known` is updated in place so a later file
 * in the same batch dedupes against this one.
 */
export function applyDedupe<T extends Pick<NormalizedRow, 'date' | 'amountCents' | 'description'>>(
  rows: T[],
  known: Map<string, number>,
): DedupeResult<T> {
  const seenInFile = new Map<string, number>()
  const accepted: T[] = []
  const duplicates: T[] = []
  const baseline = new Map(known)

  for (const row of rows) {
    const key = dedupeKey(row)
    const occurrence = (seenInFile.get(key) ?? 0) + 1
    seenInFile.set(key, occurrence)
    if (occurrence > (baseline.get(key) ?? 0)) {
      accepted.push(row)
      known.set(key, Math.max(known.get(key) ?? 0, occurrence))
    } else {
      duplicates.push(row)
    }
  }

  return { accepted, duplicates }
}
