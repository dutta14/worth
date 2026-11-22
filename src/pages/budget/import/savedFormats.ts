import { resolveMapping, type MappingDraft } from './mapping'
import { DATE_FORMATS } from './parseDate'
import { headerSignature, parseFileText, type ParsedFile, type ParseSettings } from './parseFile'
import type { AmountMode, ColumnMapping, DateFormat, Delimiter, DecimalSeparator, SignConvention } from './types'

export const FORMATS_SCHEMA_VERSION = 1
export const MAX_SAVED_FORMATS = 50
export const MAX_FORMAT_NAME = 60
export const DEFAULT_FORMAT_NAME = 'Saved format'

/** Column references are header names, or "#n" (1-based position) when the file has no usable name for the column. */
export type ColumnRef = string | null

export interface SavedFormatColumns {
  date: ColumnRef
  description: ColumnRef
  amount: ColumnRef
  debit: ColumnRef
  credit: ColumnRef
  category: ColumnRef
}

export interface SavedFormat {
  id: string
  name: string
  /** Lowercased, trimmed, pipe-joined header names; "#1|#2|..." when the file has no header row. */
  headerSignature: string
  delimiter: Delimiter
  hasHeader: boolean
  columns: SavedFormatColumns
  amountMode: AmountMode
  signConvention: SignConvention
  dateFormat: DateFormat | null
  decimalSeparator: DecimalSeparator
  /** YYYY-MM-DD */
  lastUsed: string
}

export interface FormatsFile {
  schemaVersion: typeof FORMATS_SCHEMA_VERSION
  mappings: SavedFormat[]
}

export const emptyFormatsFile = (): FormatsFile => ({ schemaVersion: FORMATS_SCHEMA_VERSION, mappings: [] })

export type FormatsParse = { kind: 'ok'; file: FormatsFile } | { kind: 'corrupt' } | { kind: 'newer' }

const DELIMITERS: readonly Delimiter[] = [',', ';', '\t', '|']
const COLUMN_KEYS = ['date', 'description', 'amount', 'debit', 'credit', 'category'] as const
const DAY = /^\d{4}-\d{2}-\d{2}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseFormat(raw: unknown): SavedFormat | null {
  if (!isRecord(raw) || !isRecord(raw.columns)) return null
  const { id, name, headerSignature, delimiter, hasHeader, amountMode, signConvention, dateFormat, decimalSeparator } =
    raw
  const lastUsed = raw.lastUsed
  if (typeof id !== 'string' || id === '' || typeof name !== 'string' || typeof headerSignature !== 'string')
    return null
  if (!DELIMITERS.includes(delimiter as Delimiter) || typeof hasHeader !== 'boolean') return null
  if (amountMode !== 'single' && amountMode !== 'split') return null
  if (signConvention !== 'negative-is-spending' && signConvention !== 'positive-is-spending') return null
  if (dateFormat !== null && !DATE_FORMATS.includes(dateFormat as DateFormat)) return null
  if (decimalSeparator !== '.' && decimalSeparator !== ',') return null
  if (typeof lastUsed !== 'string' || !DAY.test(lastUsed)) return null

  const columns = {} as SavedFormatColumns
  for (const key of COLUMN_KEYS) {
    const ref = raw.columns[key]
    if (ref !== null && typeof ref !== 'string') return null
    columns[key] = ref
  }
  if (columns.date === null) return null

  return {
    id,
    name,
    headerSignature,
    delimiter: delimiter as Delimiter,
    hasHeader,
    columns,
    amountMode,
    signConvention,
    dateFormat: dateFormat as DateFormat | null,
    decimalSeparator,
    lastUsed,
  }
}

/**
 * Reads the raw file content. Anything that is not exactly what this version writes is refused whole, so the
 * file is never rewritten from a partial reading: a newer `schemaVersion` is 'newer', everything else 'corrupt'.
 */
export function parseFormatsFile(raw: unknown): FormatsParse {
  if (!isRecord(raw)) return { kind: 'corrupt' }
  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > FORMATS_SCHEMA_VERSION) return { kind: 'newer' }
  if (raw.schemaVersion !== FORMATS_SCHEMA_VERSION || !Array.isArray(raw.mappings)) return { kind: 'corrupt' }
  const mappings: SavedFormat[] = []
  for (const entry of raw.mappings) {
    const format = parseFormat(entry)
    if (format === null) return { kind: 'corrupt' }
    mappings.push(format)
  }
  return { kind: 'ok', file: { schemaVersion: FORMATS_SCHEMA_VERSION, mappings } }
}

/** The file name without its extension, digits and separators: "Checking-2026-10.csv" becomes "Checking". */
export function defaultFormatName(fileName: string): string {
  const stem = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  const name = stem
    .replace(/[0-9]/g, ' ')
    .replace(/[-_.\s]+/g, ' ')
    .trim()
  return (name === '' ? DEFAULT_FORMAT_NAME : name).slice(0, MAX_FORMAT_NAME)
}

export const cleanFormatName = (name: string, fallback: string): string => {
  const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, MAX_FORMAT_NAME).trim()
  return trimmed === '' ? fallback : trimmed
}

const positionSignature = (width: number): string => Array.from({ length: width }, (_, i) => `#${i + 1}`).join('|')

const normalizedName = (header: string): string => header.trim().toLowerCase()

/** The signature a file has under the format's rules: header names, or positions when there is no header row. */
export const signatureOf = (headers: string[], hasHeader: boolean): string =>
  hasHeader ? headerSignature(headers) : positionSignature(headers.length)

function refFor(index: number | null, headers: string[], hasHeader: boolean): ColumnRef {
  if (index === null) return null
  const name = normalizedName(headers[index] ?? '')
  const unique = name !== '' && headers.filter(header => normalizedName(header) === name).length === 1
  return hasHeader && unique ? headers[index].trim() : `#${index + 1}`
}

/** Resolves a reference to a column index, or null when it is missing or the name is ambiguous. */
function resolveRef(ref: string, headers: string[]): number | null {
  const position = /^#(\d+)$/.exec(ref)
  if (position) {
    const index = Number(position[1]) - 1
    return index < headers.length ? index : null
  }
  const name = normalizedName(ref)
  const matches = headers.flatMap((header, i) => (normalizedName(header) === name ? [i] : []))
  return matches.length === 1 ? matches[0] : null
}

const referencedRefs = (columns: SavedFormatColumns): string[] =>
  COLUMN_KEYS.flatMap(key => (columns[key] === null ? [] : [columns[key]]))

export type SavedFormatContent = Omit<SavedFormat, 'id' | 'lastUsed'>

/** The part of a format worth remembering from a confirmed mapping. */
export function formatContent(name: string, parsed: ParsedFile, mapping: ColumnMapping): SavedFormatContent {
  const { headers, hasHeader } = parsed.detection
  const ref = (index: number | null) => refFor(index, headers, hasHeader)
  return {
    name,
    headerSignature: signatureOf(headers, hasHeader),
    delimiter: parsed.delimiter,
    hasHeader,
    columns: {
      date: ref(mapping.date),
      description: ref(mapping.description),
      amount: ref(mapping.amount),
      debit: ref(mapping.debit),
      credit: ref(mapping.credit),
      category: ref(mapping.category),
    },
    amountMode: mapping.amountMode,
    signConvention: mapping.signConvention,
    dateFormat: mapping.dateFormat,
    decimalSeparator: mapping.decimalSeparator,
  }
}

/** The mapping a saved format gives this file, or null when a column is missing or the dates no longer fit. */
export function resolveSavedFormat(format: SavedFormat, headers: string[], records: string[][]): ColumnMapping | null {
  const index = (ref: ColumnRef): number | null | undefined =>
    ref === null ? null : (resolveRef(ref, headers) ?? undefined)
  const resolved = Object.fromEntries(COLUMN_KEYS.map(key => [key, index(format.columns[key])])) as Record<
    (typeof COLUMN_KEYS)[number],
    number | null | undefined
  >
  if (COLUMN_KEYS.some(key => resolved[key] === undefined) || resolved.date === null) return null

  const draft: MappingDraft = {
    amountMode: format.amountMode,
    date: resolved.date as number,
    description: resolved.description as number | null,
    amount: resolved.amount as number | null,
    debit: resolved.debit as number | null,
    credit: resolved.credit as number | null,
    category: resolved.category as number | null,
    signConvention: format.signConvention,
    dateFormat: format.dateFormat,
    decimalSeparator: format.decimalSeparator,
  }
  return resolveMapping(records, draft).mapping
}

export interface SavedFormatMatch {
  format: SavedFormat
  mapping: ColumnMapping
}

const newestFirst = (a: SavedFormat, b: SavedFormat): number =>
  a.lastUsed < b.lastUsed ? 1 : a.lastUsed > b.lastUsed ? -1 : 0

/**
 * Finds the saved format for a parsed file: the same delimiter and header setting, then an exact header
 * signature, then a format whose every named column is present (a reordered or extended export). Formats that
 * point at columns by position only match on an exact signature.
 */
export function matchSavedFormat(formats: SavedFormat[], parsed: ParsedFile): SavedFormatMatch | null {
  const { headers, hasHeader, dataRecords } = parsed.detection
  const signature = signatureOf(headers, hasHeader)
  const sameShape = formats.filter(f => f.delimiter === parsed.delimiter && f.hasHeader === hasHeader)
  const exact = sameShape.filter(f => f.headerSignature === signature).sort(newestFirst)
  const byName = hasHeader
    ? sameShape
        .filter(f => f.headerSignature !== signature && referencedRefs(f.columns).every(ref => !ref.startsWith('#')))
        .sort(newestFirst)
    : []
  for (const format of [...exact, ...byName]) {
    const mapping = resolveSavedFormat(format, headers, dataRecords)
    if (mapping) return { format, mapping }
  }
  return null
}

/** Characters read when probing a file with another delimiter or header setting, so large files stay cheap. */
const PROBE_CHARS = 64 * 1024

export interface FormatLookup {
  settings: ParseSettings
  parsed: ParsedFile
  match: SavedFormatMatch
}

/**
 * Looks for a saved format for `text`. The file as detected is tried first; if nothing matches, the settings
 * other saved formats used (a delimiter or header choice the sniffer would not make on its own) are tried on
 * a sample, and the whole file is re-read with the settings that matched.
 */
export function lookupSavedFormat(text: string, detected: ParsedFile, formats: SavedFormat[]): FormatLookup | null {
  if (formats.length === 0) return null
  const detectedSettings: ParseSettings = { delimiter: null, hasHeader: null, headerRow: null }
  const direct = matchSavedFormat(formats, detected)
  if (direct) return { settings: detectedSettings, parsed: detected, match: direct }

  const tried = new Set([`${detected.delimiter}|${detected.detection.hasHeader}`])
  for (const format of formats) {
    const key = `${format.delimiter}|${format.hasHeader}`
    if (tried.has(key)) continue
    tried.add(key)
    const settings: ParseSettings = { delimiter: format.delimiter, hasHeader: format.hasHeader, headerRow: null }
    const probe = parseFileText(text.slice(0, PROBE_CHARS), settings)
    if (probe.detection.dataRecords.length === 0 || matchSavedFormat(formats, probe) === null) continue
    const parsed = parseFileText(text, settings)
    const match = matchSavedFormat(formats, parsed)
    if (match) return { settings, parsed, match }
  }
  return null
}

export type FormatUpdate =
  { kind: 'save'; replaceId: string | null; content: SavedFormatContent } | { kind: 'touch'; id: string }

const nextId = (mappings: SavedFormat[]): string => {
  const used = new Set(mappings.map(f => f.id))
  let n = mappings.length + 1
  while (used.has(`f_${String(n).padStart(2, '0')}`)) n++
  return `f_${String(n).padStart(2, '0')}`
}

/**
 * Applies saves and "used again" updates to the file as it is now on disk. A save replaces the entry it came
 * from (or one with the same header signature) and otherwise adds one. Over 50 entries, the least recently
 * used ones go, never the ones just written.
 */
export function applyFormatUpdates(file: FormatsFile, updates: FormatUpdate[], today: string): FormatsFile {
  let mappings = file.mappings.map(f => ({ ...f }))
  const touched = new Set<string>()

  for (const update of updates) {
    if (update.kind === 'touch') {
      const target = mappings.find(f => f.id === update.id)
      if (target) {
        target.lastUsed = today
        touched.add(target.id)
      }
      continue
    }
    const { content } = update
    const existing =
      mappings.find(f => f.id === update.replaceId) ??
      mappings.find(
        f =>
          f.headerSignature === content.headerSignature &&
          f.delimiter === content.delimiter &&
          f.hasHeader === content.hasHeader,
      )
    if (existing) {
      Object.assign(existing, content, { lastUsed: today })
      touched.add(existing.id)
    } else {
      const id = nextId(mappings)
      mappings.push({ ...content, id, lastUsed: today })
      touched.add(id)
    }
  }

  while (mappings.length > MAX_SAVED_FORMATS) {
    let oldest = -1
    mappings.forEach((f, i) => {
      if (!touched.has(f.id) && (oldest === -1 || f.lastUsed < mappings[oldest].lastUsed)) oldest = i
    })
    if (oldest === -1) break
    mappings = mappings.filter((_, i) => i !== oldest)
  }
  return { schemaVersion: FORMATS_SCHEMA_VERSION, mappings }
}
