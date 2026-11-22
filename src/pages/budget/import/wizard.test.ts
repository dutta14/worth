import { describe, it, expect } from 'vitest'
import { ImportLimitError, type ReadableFile } from './readFile'
import { dateInfo, initialDraft, legacyMapping, readableDate, resolveMapping, sameSignWarning } from './mapping'
import { createWizardFile, loadWizardFiles, noRowsMessage, reparseWizardFile } from './wizardFiles'
import { canGoBack, hasColumnsStep, initialWizardState, wizardReducer, type WizardState } from './wizardState'
import { MAX_FILES } from './constants'
import { emptyFormatsFile } from './savedFormats'
import f01 from './fixtures/F01-debit-credit.csv?raw'
import f02b from './fixtures/F02b-transaction-date.csv?raw'
import f04 from './fixtures/F04-european-semicolon.csv?raw'
import f10 from './fixtures/F10-ambiguous-dates.csv?raw'
import f11 from './fixtures/F11-legacy-canonical.csv?raw'

const asFile = (name: string, text: string): ReadableFile => {
  const bytes = new TextEncoder().encode(text)
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer }
}

const must = <T>(value: T | null): T => {
  if (value === null) throw new Error('expected a value')
  return value
}

describe('mapping', () => {
  it('suggests columns from the header and leaves sign and ambiguous date format unchosen', () => {
    const file = must(createWizardFile('f02b.csv', f02b))
    expect(file.auto).toBeNull()
    expect(file.draft).toMatchObject({ date: 0, description: 1, amount: 2, signConvention: null })
    const resolved = resolveMapping(file.parsed.detection.dataRecords, file.draft)
    expect(resolved.problems).toEqual(['sign'])
    expect(resolved.mapping).toBeNull()
  })

  it('resolves once the sign is chosen', () => {
    const file = must(createWizardFile('f02b.csv', f02b))
    const { mapping, problems } = resolveMapping(file.parsed.detection.dataRecords, {
      ...file.draft,
      signConvention: 'negative-is-spending',
    })
    expect(problems).toEqual([])
    expect(mapping).toMatchObject({ dateFormat: 'YYYY-MM-DD', amount: 2 })
  })

  it('asks for a date format when dates are ambiguous, and accepts a pick', () => {
    const file = must(createWizardFile('f10.csv', f10))
    const draft = { ...file.draft, signConvention: 'negative-is-spending' as const }
    const records = file.parsed.detection.dataRecords
    expect(resolveMapping(records, draft).problems).toEqual(['date-format'])
    const info = dateInfo(records, draft)
    expect(info.candidates.length).toBeGreaterThan(1)
    const picked = resolveMapping(records, { ...draft, dateFormat: 'DD/MM/YYYY' })
    expect(picked.mapping?.dateFormat).toBe('DD/MM/YYYY')
    expect(readableDate('03/04/2026', 'DD/MM/YYYY')).toBe('Mar 4, 2026'.replace('Mar 4', 'Apr 3'))
    expect(readableDate('99/99/2026', 'DD/MM/YYYY')).toBeNull()
  })

  it('reports each missing choice', () => {
    const records = [['2026-10-01', 'x', '1']]
    const base = initialDraft(['Date', 'Desc', 'Amt'], records)
    expect(resolveMapping(records, { ...base, date: null }).problems).toContain('date-column')
    expect(resolveMapping(records, { ...base, date: 0, amount: null }).problems).toContain('amount-column')
    expect(
      resolveMapping(records, { ...base, date: 1, amount: 2, signConvention: 'negative-is-spending' }).problems,
    ).toContain('no-dates')
    expect(
      resolveMapping(records, { ...base, date: 0, amountMode: 'split', debit: null, credit: null }).problems,
    ).toContain('money-column')
  })

  it('handles debit and credit columns and guesses comma decimals', () => {
    const split = must(createWizardFile('f01.csv', f01))
    expect(split.draft.amountMode).toBe('split')
    expect(
      resolveMapping(split.parsed.detection.dataRecords, { ...split.draft, signConvention: 'negative-is-spending' })
        .mapping,
    ).not.toBeNull()
    const german = must(createWizardFile('f04.csv', f04))
    expect(german.parsed.delimiter).toBe(';')
    expect(initialDraft(['Date', 'Amount'], [['2026-10-01', '-4,50']]).decimalSeparator).toBe(',')
  })

  it('skips Columns for legacy files only when dates are unambiguous', () => {
    expect(must(createWizardFile('f11.csv', f11)).auto).toBe('legacy')
    const ambiguous = 'Date,Category,Amount,Description\n03/04/2026,A,-1.00,x'
    expect(must(createWizardFile('a.csv', ambiguous)).auto).toBeNull()
    expect(legacyMapping(['Date', 'Amount'], [])).toBeNull()
  })

  it('warns when every amount has the same sign', () => {
    const records = [
      ['2026-10-01', 'a', '5.00'],
      ['2026-10-02', 'b', '6.00'],
    ]
    const draft = initialDraft(['Date', 'Description', 'Amount'], records)
    expect(sameSignWarning(records, draft)).toBe('positive')
    expect(sameSignWarning([['2026-10-01', 'a', '-5.00']], draft)).toBe('negative')
    expect(
      sameSignWarning(
        [
          ['x', 'a', '-5.00'],
          ['y', 'b', '5.00'],
        ],
        draft,
      ),
    ).toBeNull()
    expect(sameSignWarning(records, { ...draft, amountMode: 'split' })).toBeNull()
  })
})

describe('wizardFiles', () => {
  it('returns null for text with no data rows and re-parses with new settings', () => {
    expect(createWizardFile('empty.csv', '\n\n')).toBeNull()
    const file = must(createWizardFile('f02b.csv', f02b))
    const again = reparseWizardFile(file, { delimiter: ';', hasHeader: null, headerRow: null })
    expect(again.mapping).toBeNull()
    expect(again.settings.delimiter).toBe(';')
  })

  it('loads files and texts', async () => {
    const result = await loadWizardFiles({ files: [asFile('a.csv', f02b)], texts: [{ name: 'b.csv', text: f11 }] })
    expect(result.ok && result.files.map(f => f.name)).toEqual(['b.csv', 'a.csv'])
  })

  it('refuses too many files', async () => {
    const files = Array.from({ length: MAX_FILES + 1 }, (_, i) => asFile(`${i}.csv`, f02b))
    const result = await loadWizardFiles({ files })
    expect(result).toMatchObject({ ok: false, canPickAgain: true })
    expect(!result.ok && result.message).toBe(`You chose ${MAX_FILES + 1} files. Choose ${MAX_FILES} files or fewer.`)
  })

  it('refuses a file with no rows, with the spec message', async () => {
    const result = await loadWizardFiles({ files: [asFile('blank.csv', '\n\n')] })
    expect(!result.ok && result.message).toBe(noRowsMessage('blank.csv'))
  })

  it('refuses a file over the size limit and one it cannot read', async () => {
    const big: ReadableFile = { name: 'big.csv', size: 11 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) }
    const tooLarge = await loadWizardFiles({ files: [big] })
    expect(!tooLarge.ok && tooLarge.message).toBe(
      'big.csv is larger than 10 MB. Split it into smaller files and try again.',
    )
    const broken: ReadableFile = {
      name: 'x.csv',
      size: 3,
      arrayBuffer: async () => {
        throw new Error('denied')
      },
    }
    const unreadable = await loadWizardFiles({ files: [broken] })
    expect(!unreadable.ok && unreadable.message).toContain('We could not read x.csv')
    expect(new ImportLimitError('file-too-large', 'x').code).toBe('file-too-large')
  })

  it('refuses a file with too many rows', async () => {
    const rows = Array.from({ length: 50_001 }, () => '2026-10-01,A,-1.00').join('\n')
    const result = await loadWizardFiles({ files: [asFile('long.csv', `Date,Description,Amount\n${rows}`)] })
    expect(!result.ok && result.message).toContain('50,000 rows at a time')
  })
})

describe('wizardReducer', () => {
  const load = (...texts: string[]): WizardState => {
    const files = texts.map((text, i) => must(createWizardFile(`f${i}.csv`, text)))
    return wizardReducer(initialWizardState, {
      type: 'loaded',
      files,
      formats: { state: 'ready', file: emptyFormatsFile() },
    })
  }
  const choose = (state: WizardState): WizardState => {
    const file = state.files[state.fileIndex]
    return wizardReducer(state, { type: 'draft', draft: { ...file.draft, signConvention: 'negative-is-spending' } })
  }

  it('goes straight to review when every file maps by itself', () => {
    const state = load(f11)
    expect(state.phase).toBe('review')
    expect(hasColumnsStep(state.files)).toBe(false)
    expect(canGoBack(state)).toBe(false)
  })

  it('stops at Columns for a file that needs choices and ignores confirm until it resolves', () => {
    const state = load(f02b)
    expect(state.phase).toBe('columns')
    expect(wizardReducer(state, { type: 'confirm-columns' })).toBe(state)
    const next = wizardReducer(choose(state), { type: 'confirm-columns' })
    expect(next.phase).toBe('review')
    expect(next.files[0].mapping).not.toBeNull()
    expect(canGoBack(next)).toBe(true)
    expect(wizardReducer(next, { type: 'back' }).phase).toBe('columns')
  })

  it('reuses a confirmed mapping for later files with the same headers', () => {
    const state = wizardReducer(choose(load(f02b, f02b)), { type: 'confirm-columns' })
    expect(state.phase).toBe('review')
    expect(state.files[1].auto).toBe('reused')
  })

  it('walks through files with different headers one at a time', () => {
    let state = load(f02b, f10)
    state = wizardReducer(choose(state), { type: 'confirm-columns' })
    expect(state).toMatchObject({ phase: 'columns', fileIndex: 1 })
    expect(canGoBack(state)).toBe(true)
    expect(wizardReducer(state, { type: 'back' }).fileIndex).toBe(0)
    expect(canGoBack(wizardReducer(state, { type: 'back' }))).toBe(false)
    expect(wizardReducer(wizardReducer(state, { type: 'back' }), { type: 'back' }).fileIndex).toBe(0)
  })

  it('drops a reused mapping when the source file is re-parsed', () => {
    let state = wizardReducer(choose(load(f02b, f02b)), { type: 'confirm-columns' })
    state = wizardReducer(state, { type: 'back' })
    state = wizardReducer(state, { type: 'reparse', settings: { delimiter: ';', hasHeader: null, headerRow: null } })
    expect(state.files[0].mapping).toBeNull()
  })

  it('tracks options, commit results, undo and close', () => {
    let state = load(f11)
    state = wizardReducer(state, { type: 'options', options: { replaceMonths: true } })
    expect(state.options).toEqual({ skipDuplicates: true, replaceMonths: true })
    state = wizardReducer(state, { type: 'committing' })
    expect(state.phase).toBe('committing')
    const failure = {
      ok: false as const,
      reason: 'write' as const,
      failedMonths: ['2026-10'],
      categoriesFailed: false,
      restored: true,
    }
    state = wizardReducer(state, { type: 'committed', result: failure, formatNote: null })
    expect(state).toMatchObject({ phase: 'result', commit: failure })
    state = wizardReducer(state, { type: 'review-again' })
    expect(state).toMatchObject({ phase: 'review', commit: null })
    expect(wizardReducer(state, { type: 'undo-failed' }).undoFailed).toBe(true)
    expect(wizardReducer(state, { type: 'undone' }).undone).toBe(true)
    expect(wizardReducer(state, { type: 'close' })).toEqual(initialWizardState)
  })

  it('shows loading and load failures', () => {
    const loading = wizardReducer(initialWizardState, { type: 'loading', names: ['a.csv'] })
    expect(loading).toMatchObject({ phase: 'loading', loadingNames: ['a.csv'] })
    const failed = wizardReducer(loading, { type: 'load-failed', failure: { message: 'no', canPickAgain: true } })
    expect(failed).toMatchObject({ phase: 'error', failure: { message: 'no' } })
  })
})
