import { describe, it, expect, vi } from 'vitest'
import { assertFileCount, assertRowCount, decodeBytes, ImportLimitError, readFile, type ReadableFile } from './readFile'
import { MAX_DATA_ROWS, MAX_FILE_BYTES, MAX_FILES } from './constants'

const bytesOf = (...values: number[]): Uint8Array => Uint8Array.from(values)
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

function utf16(text: string, littleEndian: boolean, withBom = true): Uint8Array {
  const out: number[] = withBom ? (littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]) : []
  for (const unit of Array.from({ length: text.length }, (_, i) => text.charCodeAt(i))) {
    out.push(...(littleEndian ? [unit & 0xff, unit >> 8] : [unit >> 8, unit & 0xff]))
  }
  return Uint8Array.from(out)
}

const fileOf = (name: string, bytes: Uint8Array, size = bytes.length): ReadableFile => ({
  name,
  size,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
})

describe('decodeBytes', () => {
  it('decodes plain UTF-8', () => {
    expect(decodeBytes(utf8('Café,€5'))).toEqual({ text: 'Café,€5', encoding: 'utf-8' })
  })

  it('strips a UTF-8 BOM', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('Date,Amount')])
    expect(decodeBytes(bytes)).toEqual({ text: 'Date,Amount', encoding: 'utf-8' })
  })

  it('decodes UTF-16 LE with a BOM', () => {
    expect(decodeBytes(utf16('Date\tAmount\n', true))).toEqual({ text: 'Date\tAmount\n', encoding: 'utf-16le' })
  })

  it('decodes UTF-16 BE with a BOM', () => {
    expect(decodeBytes(utf16('Bäckerei', false))).toEqual({ text: 'Bäckerei', encoding: 'utf-16be' })
  })

  it('falls back to windows-1252 when the bytes are not valid UTF-8', () => {
    // "Bäckerei Müller € –" in windows-1252
    const bytes = bytesOf(0x42, 0xe4, 0x63, 0x6b, 0x65, 0x72, 0x65, 0x69, 0x20, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72)
    expect(decodeBytes(bytes)).toEqual({ text: 'Bäckerei Müller', encoding: 'windows-1252' })
  })

  it('maps the windows-1252 specific block (euro, dashes, smart quotes)', () => {
    const decoded = decodeBytes(bytesOf(0x80, 0x20, 0x96, 0x20, 0x93, 0x41, 0x94))
    expect(decoded).toEqual({ text: '€ – “A”', encoding: 'windows-1252' })
  })

  it('decodes an empty file as empty UTF-8', () => {
    expect(decodeBytes(new Uint8Array())).toEqual({ text: '', encoding: 'utf-8' })
  })

  it('keeps a lone BOM-less 0xFF byte readable as windows-1252', () => {
    expect(decodeBytes(bytesOf(0xff))).toEqual({ text: 'ÿ', encoding: 'windows-1252' })
  })

  it('decodes every windows-1252 byte per the WHATWG table, including the 0x80-0x9F block', () => {
    const all = Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i)
    const { text } = decodeBytes(all)
    expect(text).toHaveLength(128)
    expect(text.slice(0, 32)).toBe('€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ')
    expect(text.slice(32)).toBe(Array.from({ length: 96 }, (_, i) => String.fromCharCode(0xa0 + i)).join(''))
  })

  it('decodes windows-1252 input larger than one decode chunk', () => {
    const bytes = new Uint8Array(20000).fill(0xe4)
    expect(decodeBytes(bytes).text).toBe('ä'.repeat(20000))
  })
})

describe('readFile', () => {
  it('reads and decodes a file', async () => {
    await expect(readFile(fileOf('a.csv', utf8('Date,Amount\n')))).resolves.toEqual({
      text: 'Date,Amount\n',
      encoding: 'utf-8',
    })
  })

  it('refuses a file above 10 MB without reading it', async () => {
    const arrayBuffer = vi.fn()
    const promise = readFile({ name: 'big.csv', size: MAX_FILE_BYTES + 1, arrayBuffer })
    await expect(promise).rejects.toMatchObject({ code: 'file-too-large', fileName: 'big.csv' })
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('accepts a file of exactly 10 MB', async () => {
    const bytes = new Uint8Array(MAX_FILE_BYTES).fill(0x61)
    const result = await readFile(fileOf('limit.csv', bytes))
    expect(result.text).toHaveLength(MAX_FILE_BYTES)
  })

  it('refuses when the real byte length exceeds the limit although size said otherwise', async () => {
    const bytes = new Uint8Array(MAX_FILE_BYTES + 1).fill(0x61)
    await expect(readFile(fileOf('liar.csv', bytes, 10))).rejects.toMatchObject({ code: 'file-too-large' })
  })

  it('reports an unreadable file when reading fails', async () => {
    const file: ReadableFile = {
      name: 'gone.csv',
      size: 5,
      arrayBuffer: () => Promise.reject(new Error('NotReadableError')),
    }
    await expect(readFile(file)).rejects.toMatchObject({ code: 'unreadable', fileName: 'gone.csv' })
  })

  it('refuses binary content such as a spreadsheet', async () => {
    const zip = bytesOf(0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00)
    await expect(readFile(fileOf('sheet.xlsx', zip))).rejects.toMatchObject({ code: 'unreadable' })
  })

  it('accepts UTF-16 text, whose bytes contain NULs', async () => {
    const result = await readFile(fileOf('u16.csv', utf16('Date\tAmount', true)))
    expect(result).toEqual({ text: 'Date\tAmount', encoding: 'utf-16le' })
  })

  it('throws ImportLimitError instances', async () => {
    const error = await readFile({ name: 'x', size: MAX_FILE_BYTES + 1, arrayBuffer: vi.fn() }).catch(e => e)
    expect(error).toBeInstanceOf(ImportLimitError)
    expect(error.name).toBe('ImportLimitError')
    expect(error.message).toContain('x')
  })
})

describe('limits', () => {
  it('allows exactly 20 files and refuses 21', () => {
    expect(() => assertFileCount(MAX_FILES)).not.toThrow()
    expect(() => assertFileCount(MAX_FILES + 1)).toThrow(expect.objectContaining({ code: 'too-many-files' }))
  })

  it('allows exactly 50,000 data rows and refuses 50,001', () => {
    expect(() => assertRowCount(MAX_DATA_ROWS)).not.toThrow()
    expect(() => assertRowCount(MAX_DATA_ROWS + 1, 'big.csv')).toThrow(
      expect.objectContaining({ code: 'too-many-rows', fileName: 'big.csv' }),
    )
  })

  it('names the file in the row-limit message, or falls back to a generic subject', () => {
    expect(() => assertRowCount(60000, 'big.csv')).toThrow(/big\.csv has 60000 rows/)
    expect(() => assertRowCount(60000)).toThrow(/The file has 60000 rows/)
  })
})
