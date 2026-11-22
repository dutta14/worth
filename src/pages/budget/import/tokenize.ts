import type { Delimiter, TokenizeError } from './types'

export interface TokenizeResult {
  records: string[][]
  errors: TokenizeError[]
}

const isBlank = (value: string): boolean => value.trim() === ''

/**
 * RFC 4180 tokenizer with the leniency real bank exports need:
 * - a quote opens a quoted field only at the start of a field (after optional spaces); elsewhere it is literal
 * - CRLF, LF and CR all end a record, except inside quotes
 * - blank lines stay in the output as `['']` so record numbers match the file
 *
 * A quote that is never closed would swallow the rest of the file. Instead the record is reported in
 * `errors`, emitted as a single raw-line cell (so it is skipped downstream with its row number), and
 * tokenizing resumes on the next line.
 *
 * `maxRecords` stops early; it exists for delimiter sniffing.
 */
export function tokenizeRecords(text: string, delimiter: Delimiter, maxRecords = Infinity): TokenizeResult {
  const records: string[][] = []
  const errors: TokenizeError[] = []
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  let record: string[] = []
  let field = ''
  let inQuotes = false
  let fieldQuoted = false
  let recordStart = 0
  let i = 0

  const endRecord = () => {
    record.push(field)
    records.push(record)
    record = []
    field = ''
    fieldQuoted = false
  }

  while (records.length < maxRecords) {
    if (i >= src.length) {
      if (!inQuotes) {
        if (field !== '' || record.length > 0 || fieldQuoted) endRecord()
        break
      }
      // Unterminated quote: report it, keep the first physical line as the record, resume after it.
      const rowNumber = records.length + 1
      errors.push({ row: rowNumber, message: `Row ${rowNumber} has an opening quote with no closing quote.` })
      let lineEnd = recordStart
      while (lineEnd < src.length && src[lineEnd] !== '\n' && src[lineEnd] !== '\r') lineEnd++
      records.push([src.slice(recordStart, lineEnd)])
      i = src[lineEnd] === '\r' && src[lineEnd + 1] === '\n' ? lineEnd + 2 : lineEnd + 1
      recordStart = i
      record = []
      field = ''
      inQuotes = false
      fieldQuoted = false
      continue
    }

    const char = src[i]

    if (inQuotes) {
      if (char === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
    } else if (char === '"' && !fieldQuoted && isBlank(field)) {
      field = ''
      inQuotes = true
      fieldQuoted = true
    } else if (char === delimiter) {
      record.push(field)
      field = ''
      fieldQuoted = false
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && src[i + 1] === '\n') i++
      endRecord()
      recordStart = i + 1
    } else {
      field += char
    }
    i++
  }

  return { records, errors }
}

/** Tokenizes the whole text; see {@link tokenizeRecords}. */
export function tokenize(text: string, delimiter: Delimiter): TokenizeResult {
  return tokenizeRecords(text, delimiter)
}
