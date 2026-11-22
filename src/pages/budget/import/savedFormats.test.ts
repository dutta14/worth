import { describe, it, expect, vi } from 'vitest'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import { loadFormats, saveFormatUpdates, FORMATS_PATH } from './importStorage'
import { resolveMapping } from './mapping'
import { parseFileText } from './parseFile'
import {
  applyFormatUpdates,
  cleanFormatName,
  defaultFormatName,
  emptyFormatsFile,
  formatContent,
  lookupSavedFormat,
  matchSavedFormat,
  MAX_SAVED_FORMATS,
  parseFormatsFile,
  resolveSavedFormat,
  type FormatsFile,
  type SavedFormat,
} from './savedFormats'
import type { ColumnMapping } from './types'
import f01 from './fixtures/F01-debit-credit.csv?raw'
import f02b from './fixtures/F02b-transaction-date.csv?raw'
import f10 from './fixtures/F10-ambiguous-dates.csv?raw'
import f04 from './fixtures/F04-european-semicolon.csv?raw'

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('expected a value')
  return value
}

/** Maps a fixture the way a user would on the Columns step. */
function confirmed(text: string, patch: Partial<Parameters<typeof resolveMapping>[1]> = {}) {
  const parsed = parseFileText(text)
  const { headers, dataRecords } = parsed.detection
  const draft = {
    amountMode: 'single' as const,
    date: 0,
    description: 1,
    amount: 2,
    debit: null,
    credit: null,
    category: null,
    signConvention: 'negative-is-spending' as const,
    dateFormat: null,
    decimalSeparator: '.' as const,
    ...patch,
  }
  const mapping = must(resolveMapping(dataRecords, draft).mapping)
  return { parsed, headers, mapping }
}

const savedFrom = (text: string, name: string, patch = {}, id = 'f_01', lastUsed = '2026-11-08'): SavedFormat => {
  const { parsed, mapping } = confirmed(text, patch)
  return { ...formatContent(name, parsed, mapping), id, lastUsed }
}

const checking = (): SavedFormat =>
  savedFrom(f01, 'Checking export', {
    amountMode: 'split',
    amount: null,
    debit: 2,
    credit: 3,
    dateFormat: 'MM/DD/YYYY',
  })

describe('defaultFormatName and cleanFormatName', () => {
  it.each([
    ['Checking-2026-10.csv', 'Checking'],
    ['chase_activity_20261108.CSV', 'chase activity'],
    ['statement.csv', 'statement'],
    ['2026-10.csv', 'Saved format'],
    ['Imported CSV', 'Imported CSV'],
    ['a'.repeat(80) + '.csv', 'a'.repeat(60)],
  ])('names %s as %s', (file, name) => {
    expect(defaultFormatName(file)).toBe(name)
  })

  it('collapses spaces, trims, caps the length and falls back when blank', () => {
    expect(cleanFormatName('  My   bank  ', 'x')).toBe('My bank')
    expect(cleanFormatName('   ', 'Fallback')).toBe('Fallback')
    expect(cleanFormatName('b'.repeat(100), 'x')).toHaveLength(60)
  })
})

describe('parseFormatsFile', () => {
  const valid = (): FormatsFile => ({ schemaVersion: 1, mappings: [checking()] })

  it('reads what this version writes', () => {
    expect(parseFormatsFile(JSON.parse(JSON.stringify(valid())))).toEqual({ kind: 'ok', file: valid() })
  })

  it('accepts an empty list', () => {
    expect(parseFormatsFile({ schemaVersion: 1, mappings: [] })).toEqual({ kind: 'ok', file: emptyFormatsFile() })
  })

  it('reports a newer schema version as newer, even when its shape is unknown', () => {
    expect(parseFormatsFile({ schemaVersion: 2, mappings: 'whatever' })).toEqual({ kind: 'newer' })
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'text'],
    ['no schemaVersion', { mappings: [] }],
    ['schemaVersion 0', { schemaVersion: 0, mappings: [] }],
    ['mappings not a list', { schemaVersion: 1, mappings: {} }],
  ])('treats %s as corrupt', (_, raw) => {
    expect(parseFormatsFile(raw)).toEqual({ kind: 'corrupt' })
  })

  const broken: [string, (entry: Record<string, unknown>) => void][] = [
    ['a missing id', e => delete e.id],
    ['an empty id', e => (e.id = '')],
    ['a non-string name', e => (e.name = 3)],
    ['a bad delimiter', e => (e.delimiter = 'x')],
    ['a non-boolean hasHeader', e => (e.hasHeader = 'yes')],
    ['a bad amount mode', e => (e.amountMode = 'both')],
    ['a bad sign convention', e => (e.signConvention = 'maybe')],
    ['an unknown date format', e => (e.dateFormat = 'YYYY.DD.MM')],
    ['a bad decimal separator', e => (e.decimalSeparator = ';')],
    ['a bad lastUsed', e => (e.lastUsed = 'yesterday')],
    ['a non-string column reference', e => (e.columns = { ...(e.columns as object), amount: 4 })],
    ['no date column', e => (e.columns = { ...(e.columns as object), date: null })],
    ['no columns', e => delete e.columns],
  ]
  it.each(broken)('refuses the whole file for %s', (_, mutate) => {
    const entry = JSON.parse(JSON.stringify(checking())) as Record<string, unknown>
    mutate(entry)
    expect(parseFormatsFile({ schemaVersion: 1, mappings: [entry] })).toEqual({ kind: 'corrupt' })
  })

  it('refuses the whole file when one entry in the list is not an object', () => {
    expect(parseFormatsFile({ schemaVersion: 1, mappings: [checking(), 7] })).toEqual({ kind: 'corrupt' })
  })

  it('allows a null date format', () => {
    const entry = { ...checking(), dateFormat: null }
    expect(parseFormatsFile({ schemaVersion: 1, mappings: [entry] }).kind).toBe('ok')
  })
})

describe('formatContent and resolveSavedFormat', () => {
  it('stores header names, the signature and the choices, and resolves back to the same mapping', () => {
    const { parsed, headers, mapping } = confirmed(f01, {
      amountMode: 'split',
      amount: null,
      debit: 2,
      credit: 3,
      dateFormat: 'MM/DD/YYYY',
    })
    const content = formatContent('Checking export', parsed, mapping)
    expect(content).toMatchObject({
      name: 'Checking export',
      headerSignature: 'date|description|debit|credit|balance',
      delimiter: ',',
      hasHeader: true,
      columns: {
        date: 'Date',
        description: 'Description',
        amount: null,
        debit: 'Debit',
        credit: 'Credit',
        category: null,
      },
      amountMode: 'split',
      dateFormat: 'MM/DD/YYYY',
    })
    const format: SavedFormat = { ...content, id: 'f_01', lastUsed: '2026-11-08' }
    expect(resolveSavedFormat(format, headers, parsed.detection.dataRecords)).toEqual(mapping)
  })

  it('refers to a column by position when the file has no usable name for it', () => {
    const text = 'Date,Amount,Amount\n2026-10-01,5.00,6.00\n2026-10-02,7.00,8.00\n'
    const { parsed, mapping } = confirmed(text, { description: null, amount: 2 })
    expect(formatContent('Dupes', parsed, mapping).columns).toMatchObject({ date: 'Date', amount: '#3' })
  })

  it('refers to every column by position when the file has no header row', () => {
    const text = '2026-10-01,Coffee,-4.50\n2026-10-02,Lunch,-9.00\n'
    const parsed = parseFileText(text, { delimiter: null, hasHeader: false, headerRow: null })
    const mapping = must(
      resolveMapping(parsed.detection.dataRecords, {
        amountMode: 'single',
        date: 0,
        description: 1,
        amount: 2,
        debit: null,
        credit: null,
        category: null,
        signConvention: 'negative-is-spending',
        dateFormat: null,
        decimalSeparator: '.',
      }).mapping,
    )
    const content = formatContent('Headerless', parsed, mapping)
    expect(content.hasHeader).toBe(false)
    expect(content.headerSignature).toBe('#1|#2|#3')
    expect(content.columns).toMatchObject({ date: '#1', description: '#2', amount: '#3' })
    const format: SavedFormat = { ...content, id: 'f_01', lastUsed: '2026-11-08' }
    expect(matchSavedFormat([format], parsed)?.mapping).toEqual(mapping)
    const wider = parseFileText('2026-10-01,Coffee,-4.50,x\n', { delimiter: null, hasHeader: false, headerRow: null })
    expect(matchSavedFormat([format], wider)).toBeNull()
  })

  it('returns null when a named column is missing, ambiguous, or the position is out of range', () => {
    const format = checking()
    const parsed = parseFileText(f01)
    const { dataRecords } = parsed.detection
    expect(resolveSavedFormat(format, ['Date', 'Description', 'Credit'], dataRecords)).toBeNull()
    expect(resolveSavedFormat(format, ['Date', 'Description', 'Debit', 'Credit', 'Debit'], dataRecords)).toBeNull()
    const byPosition = { ...format, columns: { ...format.columns, debit: '#9' } }
    expect(resolveSavedFormat(byPosition, parsed.detection.headers, dataRecords)).toBeNull()
  })

  it('returns null when the saved date format does not fit and the dates are ambiguous', () => {
    const { headers, dataRecords } = parseFileText(f10).detection
    const format = { ...savedFrom(f10, 'Ambiguous', { dateFormat: 'MM/DD/YYYY' }), dateFormat: 'DD.MM.YYYY' as const }
    expect(resolveSavedFormat(format, headers, dataRecords)).toBeNull()
  })

  it('uses the only date format the data allows when the saved one does not fit', () => {
    const { headers, dataRecords } = parseFileText(f01).detection
    const format = { ...checking(), dateFormat: 'DD.MM.YYYY' as const }
    expect(resolveSavedFormat(format, headers, dataRecords)?.dateFormat).toBe('MM/DD/YYYY')
  })
})

describe('matchSavedFormat', () => {
  it('matches on an exact header signature', () => {
    const format = checking()
    expect(matchSavedFormat([format], parseFileText(f01))?.format.id).toBe('f_01')
  })

  it('matches a reordered export whose named columns are all present', () => {
    const reordered = [
      'Balance,Credit,Debit,Description,Date',
      '5200.00,3200.00,,PAYROLL ACME CORP,10/01/2026',
      '5193.25,,6.75,STARBUCKS,10/02/2026',
    ].join('\n')
    const match = must(matchSavedFormat([checking()], parseFileText(reordered)))
    expect(match.mapping).toMatchObject({ date: 4, description: 3, debit: 2, credit: 1, amountMode: 'split' })
  })

  it('matches an export with extra columns', () => {
    const extended = ['Date,Description,Debit,Credit,Balance,Memo', '10/01/2026,PAYROLL,,3200.00,5200.00,x'].join('\n')
    expect(matchSavedFormat([checking()], parseFileText(extended))).not.toBeNull()
  })

  it('does not match when a referenced column is gone or the delimiter differs', () => {
    const missing = 'Date,Description,Debit,Balance\n10/01/2026,PAYROLL,3.00,5.00\n'
    expect(matchSavedFormat([checking()], parseFileText(missing))).toBeNull()
    expect(matchSavedFormat([checking()], parseFileText(f01.replace(/,/g, ';')))).toBeNull()
  })

  it('does not match an unrelated file', () => {
    expect(matchSavedFormat([checking()], parseFileText(f02b))).toBeNull()
  })

  it('does not match a position-based format by name', () => {
    const positional = { ...checking(), headerSignature: 'a|b', columns: { ...checking().columns, debit: '#3' } }
    expect(matchSavedFormat([positional], parseFileText(f01))).toBeNull()
  })

  it('prefers the most recently used of several exact matches', () => {
    const older = { ...checking(), id: 'f_01', name: 'Old', lastUsed: '2026-01-01' }
    const newer = { ...checking(), id: 'f_02', name: 'New', lastUsed: '2026-11-01' }
    expect(matchSavedFormat([older, newer], parseFileText(f01))?.format.name).toBe('New')
  })

  it('ranks the format sharing the most columns first, so a generic format cannot beat the issuer one', () => {
    const issuerFile = [
      'Date,Description,Amount,Category,Type,Memo',
      '2026-10-01,COFFEE,-4.50,Food,DEBIT,a',
      '2026-10-02,PAYROLL,2000.00,Income,CREDIT,b',
    ].join('\n')
    const generic = savedFrom(
      'Date,Description,Amount\n2026-10-01,COFFEE,4.50\n2026-10-02,PAYROLL,-2000.00',
      'Generic',
      { dateFormat: 'YYYY-MM-DD', signConvention: 'positive-is-spending' },
      'f_generic',
      '2026-11-09',
    )
    const issuer = savedFrom(
      'Date,Description,Amount,Category,Type\n2026-10-01,COFFEE,-4.50,Food,DEBIT\n2026-10-02,PAYROLL,2000.00,Income,CREDIT',
      'Issuer',
      { dateFormat: 'YYYY-MM-DD' },
      'f_issuer',
      '2026-01-01',
    )
    const match = must(matchSavedFormat([generic, issuer], parseFileText(issuerFile)))
    expect(match.format.id).toBe('f_issuer')
    expect(match.mapping.signConvention).toBe('negative-is-spending')
  })

  it('uses the most recently used as the tie-break between equally close formats', () => {
    const file = 'Date,Description,Amount,Memo\n2026-10-01,COFFEE,-4.50,a\n2026-10-02,PAYROLL,2000.00,b'
    const base = savedFrom(file, 'A', { dateFormat: 'YYYY-MM-DD' }, 'f_a', '2026-01-01')
    const newer = {
      ...base,
      id: 'f_b',
      name: 'B',
      lastUsed: '2026-05-01',
      headerSignature: 'date|description|amount|x',
    }
    const older = { ...base, id: 'f_a', headerSignature: 'date|description|amount|y' }
    expect(matchSavedFormat([older, newer], parseFileText(file))?.format.id).toBe('f_b')
  })

  it('falls through to the next candidate when the first one no longer resolves', () => {
    const stale = {
      ...checking(),
      id: 'f_01',
      columns: { ...checking().columns, credit: 'Gone' },
      lastUsed: '2026-11-09',
    }
    const good = { ...checking(), id: 'f_02' }
    expect(matchSavedFormat([stale, good], parseFileText(f01))?.format.id).toBe('f_02')
  })
})

describe('lookupSavedFormat', () => {
  const european = savedFrom(
    f04,
    'Sparkasse',
    { amountMode: 'single', date: 0, description: 2, amount: 3, decimalSeparator: ',', dateFormat: 'DD.MM.YYYY' },
    'f_07',
  )

  it('returns null without saved formats', () => {
    expect(lookupSavedFormat(f01, parseFileText(f01), [])).toBeNull()
  })

  it('matches the detected parse first', () => {
    const lookup = must(lookupSavedFormat(f04, parseFileText(f04), [european]))
    expect(lookup.match.format.id).toBe('f_07')
    expect(lookup.settings).toEqual({ delimiter: null, hasHeader: null, headerRow: null })
  })

  it('re-reads the file with the delimiter a saved format used when detection reads it differently', () => {
    const odd = 'Date;Memo;Amount\n2026-10-01;one, two, three;-5.00\n2026-10-02;four, five;-6.00\n'
    const parsed = parseFileText(odd, { delimiter: ',', hasHeader: null, headerRow: null })
    const semicolons = savedFrom(odd, 'Semicolon bank', { description: 1, amount: 2, dateFormat: 'YYYY-MM-DD' })
    const lookup = must(lookupSavedFormat(odd, parsed, [semicolons]))
    expect(lookup.settings).toMatchObject({ delimiter: ';' })
    expect(lookup.parsed.delimiter).toBe(';')
  })

  describe('headerless and delimiter overrides', () => {
    const headerless = (text: string) => {
      const parsed = parseFileText(text, { delimiter: null, hasHeader: false, headerRow: null })
      const draft = {
        amountMode: 'single' as const,
        date: 0,
        description: 1,
        amount: 2,
        debit: null,
        credit: null,
        category: null,
        signConvention: 'negative-is-spending' as const,
        dateFormat: 'YYYY-MM-DD' as const,
        decimalSeparator: '.' as const,
      }
      const mapping = must(resolveMapping(parsed.detection.dataRecords, draft).mapping)
      return { ...formatContent('Headerless bank', parsed, mapping), id: 'f_h', lastUsed: '2026-11-08' }
    }
    const saved = headerless('2026-02-01,coffee,-4.50\n2026-02-02,rent,-900.00\n')

    it('does not read a header row of plain text as data for a headerless format', () => {
      const text = 'Date,Description,Amount\n2026-02-05,coffee,-4.50\n2026-02-06,rent,-900.00\n'
      expect(saved.headerSignature).toBe('#1|#2|#3')
      expect(lookupSavedFormat(text, parseFileText(text), [saved])).toBeNull()
    })

    it('still matches a genuinely headerless file the sniffer reads with a header', () => {
      const text = '2026-02-05,coffee,-4.50\n2026-02-06,rent,-900.00\n2026-02-07,gas,-30.00\n'
      const lookup = must(lookupSavedFormat(text, parseFileText(text), [saved]))
      expect(lookup.match.format.id).toBe('f_h')
      expect(lookup.parsed.detection.hasHeader).toBe(false)
      expect(lookup.parsed.detection.dataRecords).toHaveLength(3)
    })

    it('rejects a headerless re-read whose first row does not start with a date', () => {
      const text = 'Posted,Memo,Total\nx,coffee,-4.50\ny,rent,-900.00\n'
      const forced = parseFileText(text, { delimiter: null, hasHeader: true, headerRow: null })
      expect(lookupSavedFormat(text, forced, [saved])).toBeNull()
    })

    it('accepts a delimiter override when the detected read looks wrong', () => {
      const text = 'Date;Memo;Amount\n2026-10-01;one;-5.00\n2026-10-02;two;-6.00\n'
      const semicolons = savedFrom(text, 'Semicolon bank', { description: 1, amount: 2, dateFormat: 'YYYY-MM-DD' })
      const wide = parseFileText(text, { delimiter: ',', hasHeader: null, headerRow: null })
      expect(lookupSavedFormat(text, wide, [semicolons])).not.toBeNull()
      const commas = 'Date,Memo,Amount\n2026-10-01,one,-5.00\n2026-10-02,two,-6.00\n'
      const asSemicolon = parseFileText(commas, { delimiter: ';', hasHeader: null, headerRow: null })
      const commaFormat = savedFrom(commas, 'Comma bank', { description: 1, amount: 2, dateFormat: 'YYYY-MM-DD' })
      expect(lookupSavedFormat(commas, asSemicolon, [{ ...commaFormat, delimiter: ',' }])).not.toBeNull()
    })
  })

  it('returns null when no saved format fits under any of their settings', () => {
    expect(lookupSavedFormat(f02b, parseFileText(f02b), [european, checking()])).toBeNull()
  })
})

describe('applyFormatUpdates', () => {
  const content = (name: string, signature = 'a|b|c') => ({
    ...formatContent(name, parseFileText(f02b), confirmed(f02b).mapping),
    headerSignature: signature,
  })

  it('adds a new format with the next free id and today as lastUsed', () => {
    const next = applyFormatUpdates(
      { schemaVersion: 1, mappings: [checking()] },
      [{ kind: 'save', replaceId: null, content: content('Card') }],
      '2026-11-22',
    )
    expect(next.mappings.map(f => [f.id, f.name, f.lastUsed])).toEqual([
      ['f_01', 'Checking export', '2026-11-08'],
      ['f_02', 'Card', '2026-11-22'],
    ])
  })

  it('does not reuse the id of an entry that already exists', () => {
    const file: FormatsFile = { schemaVersion: 1, mappings: [{ ...checking(), id: 'f_02' }] }
    const next = applyFormatUpdates(file, [{ kind: 'save', replaceId: null, content: content('Card') }], '2026-11-22')
    expect(next.mappings.map(f => f.id)).toEqual(['f_02', 'f_03'])
  })

  it('replaces the entry it came from, keeping its id', () => {
    const next = applyFormatUpdates(
      { schemaVersion: 1, mappings: [checking()] },
      [{ kind: 'save', replaceId: 'f_01', content: content('Renamed') }],
      '2026-11-22',
    )
    expect(next.mappings).toHaveLength(1)
    expect(next.mappings[0]).toMatchObject({ id: 'f_01', name: 'Renamed', lastUsed: '2026-11-22' })
  })

  it('replaces the entry with the same signature and shape instead of adding a duplicate', () => {
    const existing = checking()
    const next = applyFormatUpdates(
      { schemaVersion: 1, mappings: [existing] },
      [{ kind: 'save', replaceId: null, content: content('Again', existing.headerSignature) }],
      '2026-11-22',
    )
    expect(next.mappings).toHaveLength(1)
    expect(next.mappings[0]).toMatchObject({ id: 'f_01', name: 'Again' })
  })

  it('marks a used format as used today and ignores an unknown id', () => {
    const next = applyFormatUpdates(
      { schemaVersion: 1, mappings: [checking()] },
      [
        { kind: 'touch', id: 'f_01' },
        { kind: 'touch', id: 'nope' },
      ],
      '2026-11-22',
    )
    expect(next.mappings[0].lastUsed).toBe('2026-11-22')
  })

  it('does not change the input', () => {
    const file: FormatsFile = { schemaVersion: 1, mappings: [checking()] }
    applyFormatUpdates(file, [{ kind: 'touch', id: 'f_01' }], '2026-11-22')
    expect(file.mappings[0].lastUsed).toBe('2026-11-08')
  })

  it('drops the least recently used formats beyond the cap, never the ones just written', () => {
    const many: SavedFormat[] = Array.from({ length: MAX_SAVED_FORMATS }, (_, i) => ({
      ...checking(),
      id: `f_${i + 1}`,
      headerSignature: `sig${i}`,
      lastUsed: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    }))
    const next = applyFormatUpdates(
      { schemaVersion: 1, mappings: many },
      [{ kind: 'save', replaceId: null, content: content('Newest', 'brand-new') }],
      '2026-11-22',
    )
    expect(next.mappings).toHaveLength(MAX_SAVED_FORMATS)
    expect(next.mappings.some(f => f.name === 'Newest')).toBe(true)
    expect(next.mappings.some(f => f.id === 'f_1')).toBe(false)
    expect(next.mappings.some(f => f.id === 'f_2')).toBe(true)
  })

  it('keeps everything when the cap is exceeded only by entries that were just written', () => {
    const saves = Array.from({ length: MAX_SAVED_FORMATS + 1 }, (_, i) => ({
      kind: 'save' as const,
      replaceId: null,
      content: content(`F${i}`, `s${i}`),
    }))
    expect(applyFormatUpdates(emptyFormatsFile(), saves, '2026-11-22').mappings).toHaveLength(MAX_SAVED_FORMATS + 1)
  })
})

describe('formats storage', () => {
  const mapping: ColumnMapping = confirmed(f02b).mapping
  const save = [
    { kind: 'save' as const, replaceId: null, content: formatContent('Bank', parseFileText(f02b), mapping) },
  ]

  it('reads a missing file as an empty list', async () => {
    expect(await loadFormats(new MemoryFileStore())).toEqual({ state: 'ready', file: emptyFormatsFile() })
  })

  it('writes budget/import-formats.json and reads it back', async () => {
    const store = new MemoryFileStore()
    expect(await saveFormatUpdates(store, save, '2026-11-22')).toEqual({ ok: true })
    const loaded = await loadFormats(store)
    expect(loaded.state === 'ready' && loaded.file.mappings.map(f => f.name)).toEqual(['Bank'])
    expect(await store.exists(FORMATS_PATH)).toBe(true)
  })

  it('merges into what is on disk now instead of replacing it', async () => {
    const store = new MemoryFileStore()
    await saveFormatUpdates(store, save, '2026-11-22')
    const other = [{ ...save[0], content: { ...save[0].content, name: 'Other', headerSignature: 'x|y' } }]
    await saveFormatUpdates(store, other, '2026-11-23')
    const loaded = await loadFormats(store)
    expect(loaded.state === 'ready' && loaded.file.mappings.map(f => f.name)).toEqual(['Bank', 'Other'])
  })

  it('never overwrites a corrupt file', async () => {
    const store = new MemoryFileStore()
    await store.writeBinary(FORMATS_PATH, new ArrayBuffer(4))
    const write = vi.spyOn(store, 'writeJSON')
    expect(await loadFormats(store)).toEqual({ state: 'unreadable', reason: 'corrupt' })
    expect(await saveFormatUpdates(store, save, '2026-11-22')).toEqual({ ok: false, reason: 'unreadable' })
    expect(write).not.toHaveBeenCalled()
  })

  it('never overwrites a file from a newer version', async () => {
    const store = new MemoryFileStore()
    const newer = { schemaVersion: 2, mappings: [{ anything: true }] }
    await store.writeJSON(FORMATS_PATH, newer)
    expect(await loadFormats(store)).toEqual({ state: 'unreadable', reason: 'newer' })
    expect(await saveFormatUpdates(store, save, '2026-11-22')).toEqual({ ok: false, reason: 'unreadable' })
    expect(await store.readJSON(FORMATS_PATH, null)).toEqual(newer)
  })

  it('treats a store that throws on read as unreadable', async () => {
    const store = new MemoryFileStore()
    store.exists = async () => {
      throw new Error('denied')
    }
    expect(await loadFormats(store)).toEqual({ state: 'unreadable', reason: 'corrupt' })
  })

  it('reports a failed write', async () => {
    const store = new MemoryFileStore()
    store.writeJSON = async () => {
      throw new Error('disk full')
    }
    expect(await saveFormatUpdates(store, save, '2026-11-22')).toEqual({ ok: false, reason: 'write' })
  })
})
