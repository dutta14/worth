import { sniffDelimiter } from './delimiter'
import { detectHeaderRow, type HeaderDetection } from './headerDetect'
import { tokenize } from './tokenize'
import type { Delimiter, TokenizeError } from './types'

/** User overrides from the Columns step; `null` means "detect". */
export interface ParseSettings {
  delimiter: Delimiter | null
  hasHeader: boolean | null
  /** 1-based record number of the header row. */
  headerRow: number | null
}

export const AUTO_SETTINGS: ParseSettings = { delimiter: null, hasHeader: null, headerRow: null }

export interface ParsedFile {
  delimiter: Delimiter
  records: string[][]
  tokenErrors: TokenizeError[]
  detection: HeaderDetection
}

/** Text to records and header, with the detected delimiter and header row unless overridden. Never throws. */
export function parseFileText(text: string, settings: ParseSettings = AUTO_SETTINGS): ParsedFile {
  const delimiter = settings.delimiter ?? sniffDelimiter(text)
  const { records, errors } = tokenize(text, delimiter)
  const detection = detectHeaderRow(records, {
    hasHeader: settings.headerRow !== null ? true : (settings.hasHeader ?? undefined),
    headerIndex: settings.headerRow !== null ? settings.headerRow - 1 : undefined,
  })
  return { delimiter, records, tokenErrors: errors, detection }
}

/** Lowercased, trimmed, pipe-joined header names; two files with the same signature share a mapping. */
export const headerSignature = (headers: string[]): string => headers.map(h => h.trim().toLowerCase()).join('|')
