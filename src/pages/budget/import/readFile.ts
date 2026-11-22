import { MAX_DATA_ROWS, MAX_FILE_BYTES, MAX_FILES } from './constants'
import type { TextEncodingName } from './types'

export type ImportLimitCode = 'file-too-large' | 'too-many-files' | 'too-many-rows' | 'unreadable'

/** The only error the parsing pipeline throws; every other failure is reported as data. */
export class ImportLimitError extends Error {
  readonly code: ImportLimitCode
  readonly fileName?: string

  constructor(code: ImportLimitCode, message: string, fileName?: string) {
    super(message)
    this.name = 'ImportLimitError'
    this.code = code
    this.fileName = fileName
  }
}

export interface ReadableFile {
  name: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface DecodedText {
  text: string
  encoding: TextEncodingName
}

const hasPrefix = (bytes: Uint8Array, prefix: number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b)

/**
 * The 0x80-0x9F block of windows-1252; every other byte maps to the same Latin-1 code point.
 * Decoded by hand because Node's TextDecoder treats the windows-1252 label as plain Latin-1 (no euro
 * sign or smart quotes), so a native decode would differ between the browser and the test runtime.
 */
const WINDOWS_1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d,
  0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x009d, 0x017e, 0x0178,
]

const DECODE_CHUNK = 8192

function decodeWindows1252(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let start = 0; start < bytes.length; start += DECODE_CHUNK) {
    const codes = Array.from(bytes.subarray(start, start + DECODE_CHUNK), b =>
      b >= 0x80 && b <= 0x9f ? WINDOWS_1252_HIGH[b - 0x80] : b,
    )
    parts.push(String.fromCharCode(...codes))
  }
  return parts.join('')
}

/**
 * Decodes file bytes. A BOM selects UTF-8 (stripped) or UTF-16 LE/BE; without one the bytes are read as
 * UTF-8 and, if that is not valid UTF-8, as windows-1252.
 */
export function decodeBytes(bytes: Uint8Array): DecodedText {
  if (hasPrefix(bytes, [0xff, 0xfe])) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  }
  if (hasPrefix(bytes, [0xfe, 0xff])) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  }
  const body = hasPrefix(bytes, [0xef, 0xbb, 0xbf]) ? bytes.subarray(3) : bytes
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8' }
  } catch {
    return { text: decodeWindows1252(body), encoding: 'windows-1252' }
  }
}

/** Reads one file: refuses it above the size limit, and refuses binary content. */
export async function readFile(file: ReadableFile): Promise<DecodedText> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportLimitError('file-too-large', `${file.name} is larger than 10 MB.`, file.name)
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    throw new ImportLimitError('unreadable', `Could not read ${file.name}.`, file.name)
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ImportLimitError('file-too-large', `${file.name} is larger than 10 MB.`, file.name)
  }
  const decoded = decodeBytes(bytes)
  // NUL characters never occur in decoded text files; they mean a spreadsheet, PDF or image was chosen.
  if (decoded.text.includes('\u0000')) {
    throw new ImportLimitError('unreadable', `${file.name} is not a text file.`, file.name)
  }
  return decoded
}

export function assertFileCount(count: number): void {
  if (count > MAX_FILES) {
    throw new ImportLimitError('too-many-files', `Choose ${MAX_FILES} files or fewer.`)
  }
}

/** `dataRowCount` excludes the header row. Exactly MAX_DATA_ROWS is allowed. */
export function assertRowCount(dataRowCount: number, fileName?: string): void {
  if (dataRowCount > MAX_DATA_ROWS) {
    throw new ImportLimitError(
      'too-many-rows',
      `${fileName ?? 'The file'} has ${dataRowCount} rows. The limit is ${MAX_DATA_ROWS}.`,
      fileName,
    )
  }
}
