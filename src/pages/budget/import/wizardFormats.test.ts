import { describe, it, expect } from 'vitest'
import type { CommitFailure } from './commitImport'
import { parseFileText } from './parseFile'
import { resolveMapping } from './mapping'
import { formatContent, type FormatsFile } from './savedFormats'
import { createWizardFile, loadWizardFiles, reparseWizardFile, type WizardFile } from './wizardFiles'
import { canGoBack, hasColumnsStep, initialWizardState, wizardReducer, type WizardState } from './wizardState'
import f02b from './fixtures/F02b-transaction-date.csv?raw'
import f10 from './fixtures/F10-ambiguous-dates.csv?raw'
import f11 from './fixtures/F11-legacy-canonical.csv?raw'

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('expected a value')
  return value
}

function savedFormatsFor(text: string): FormatsFile {
  const parsed = parseFileText(text)
  const { dataRecords } = parsed.detection
  const mapping = must(
    resolveMapping(dataRecords, {
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
  return {
    schemaVersion: 1,
    mappings: [{ ...formatContent('Bank', parsed, mapping), id: 'f_01', lastUsed: '2026-11-08' }],
  }
}

const formats = savedFormatsFor(f02b)
const ready = { state: 'ready', file: formats } as const

const loaded = (...files: WizardFile[]): WizardState =>
  wizardReducer(initialWizardState, { type: 'loaded', files, formats: ready })

const savedFile = (name = 'bank.csv') => must(createWizardFile(name, f02b, formats))

describe('createWizardFile with saved formats', () => {
  it('keeps the Columns step for a file with a header row when the only saved format is headerless', () => {
    const headerless = parseFileText('2026-02-01,coffee,-4.50\n2026-02-02,rent,-900.00\n', {
      delimiter: null,
      hasHeader: false,
      headerRow: null,
    })
    const mapping = must(
      resolveMapping(headerless.detection.dataRecords, {
        amountMode: 'single',
        date: 0,
        description: 1,
        amount: 2,
        debit: null,
        credit: null,
        category: null,
        signConvention: 'negative-is-spending',
        dateFormat: 'YYYY-MM-DD',
        decimalSeparator: '.',
      }).mapping,
    )
    const only: FormatsFile = {
      schemaVersion: 1,
      mappings: [{ ...formatContent('Headerless', headerless, mapping), id: 'f_01', lastUsed: '2026-11-08' }],
    }
    const text = 'Date,Description,Amount\n2026-02-05,coffee,-4.50\n2026-02-06,rent,-900.00\n'
    const file = must(createWizardFile('bank.csv', text, only))
    expect(file.auto).toBeNull()
    expect(file.parsed.detection.hasHeader).toBe(true)
  })

  it('applies a matching saved format and skips the Columns step', () => {
    const file = savedFile()
    expect(file.auto).toBe('saved')
    expect(file.format).toEqual({ id: 'f_01', name: 'Bank' })
    expect(file.mapping).toMatchObject({ date: 0, description: 1, amount: 2, signConvention: 'negative-is-spending' })
    expect(file.remember).toEqual({ enabled: true, name: 'Bank' })
  })

  it('does not look for a saved format when the formats file could not be read', () => {
    const file = must(createWizardFile('bank.csv', f02b, null))
    expect(file.auto).toBeNull()
    expect(file.remember.enabled).toBe(false)
  })

  it('names a new format after the file and enables remembering when formats are readable', () => {
    const file = must(createWizardFile('Card-2026-11.csv', f10, formats))
    expect(file.auto).toBeNull()
    expect(file.remember).toEqual({ enabled: true, name: 'Card' })
    expect(file.format).toBeNull()
  })

  it('prefers a saved format over the legacy shape, and falls back to legacy when nothing matches', () => {
    expect(must(createWizardFile('legacy.csv', f11, formats)).auto).toBe('legacy')
  })

  it('keeps a saved format through a load of several files', async () => {
    const result = await loadWizardFiles({ texts: [{ name: 'a.csv', text: f02b }], formats })
    expect(result.ok && result.files[0].auto).toBe('saved')
  })
})

describe('wizardReducer with saved formats', () => {
  it('goes straight to Review for a saved format and has no Columns step', () => {
    const state = loaded(savedFile())
    expect(state.phase).toBe('review')
    expect(state.formats).toBe(ready)
    expect(hasColumnsStep(state.files)).toBe(false)
    expect(canGoBack(state)).toBe(false)
  })

  it('opens Columns for the file when the user changes the saved format, keeping its mapping as the draft', () => {
    const state = wizardReducer(loaded(savedFile()), { type: 'change-format', fileIndex: 0 })
    expect(state.phase).toBe('columns')
    expect(state.files[0].auto).toBeNull()
    expect(state.files[0].mapping).not.toBeNull()
    expect(state.files[0].draft.signConvention).toBe('negative-is-spending')
    expect(hasColumnsStep(state.files)).toBe(true)
    expect(canGoBack(state)).toBe(true)
  })

  it('ignores Change for a file that is not using a saved format', () => {
    const state = loaded(must(createWizardFile('legacy.csv', f11, formats)))
    expect(wizardReducer(state, { type: 'change-format', fileIndex: 0 })).toBe(state)
    expect(wizardReducer(state, { type: 'change-format', fileIndex: 5 })).toBe(state)
  })

  it('returns to Review with the saved format when Back is pressed after Change', () => {
    const original = loaded(savedFile())
    const changing = wizardReducer(original, { type: 'change-format', fileIndex: 0 })
    const edited = wizardReducer(changing, { type: 'draft', draft: { ...changing.files[0].draft, date: 1 } })
    const back = wizardReducer(edited, { type: 'back' })
    expect(back.phase).toBe('review')
    expect(back.files[0]).toBe(original.files[0])
  })

  it('returns to the saved format even after the delimiter was changed in Columns', () => {
    const changing = wizardReducer(loaded(savedFile()), { type: 'change-format', fileIndex: 0 })
    const reparsed = wizardReducer(changing, {
      type: 'reparse',
      settings: { ...changing.files[0].settings, delimiter: ';' },
    })
    expect(reparsed.files[0].mapping).toBeNull()
    expect(wizardReducer(reparsed, { type: 'back' }).files[0].auto).toBe('saved')
  })

  it('treats a confirmed change as a manual mapping that is remembered under the same format', () => {
    const changing = wizardReducer(loaded(savedFile()), { type: 'change-format', fileIndex: 0 })
    const confirmed = wizardReducer(changing, { type: 'confirm-columns' })
    expect(confirmed.phase).toBe('review')
    expect(confirmed.files[0]).toMatchObject({ auto: null, restoreTo: null, format: { id: 'f_01' } })
  })

  it('updates the remember choice of the file in the Columns step only', () => {
    const state = loaded(
      must(createWizardFile('a.csv', f10, formats)),
      must(createWizardFile('b.csv', f10.replace('Hardware', 'Garden'), formats)),
    )
    const next = wizardReducer(state, { type: 'remember', remember: { enabled: false, name: 'Mine' } })
    expect(next.files[0].remember).toEqual({ enabled: false, name: 'Mine' })
    expect(next.files[1].remember.enabled).toBe(true)
  })

  it('does not overwrite a saved format on a later file during mapping reuse', () => {
    const manual = must(createWizardFile('a.csv', f10, formats))
    const state = loaded(manual, savedFile())
    const chosen = wizardReducer(state, {
      type: 'draft',
      draft: { ...manual.draft, signConvention: 'negative-is-spending', dateFormat: 'DD/MM/YYYY' },
    })
    expect(wizardReducer(chosen, { type: 'confirm-columns' }).files[1].auto).toBe('saved')
  })

  it('resets formats and the note when the wizard closes or starts loading again', () => {
    const state = wizardReducer(loaded(savedFile()), { type: 'close' })
    expect(state.formats).toEqual(initialWizardState.formats)
    expect(wizardReducer(state, { type: 'loading', names: ['x'] }).formatNote).toBeNull()
  })

  it('keeps the format note until the user reviews again', () => {
    const base = loaded(savedFile())
    const failure: CommitFailure = {
      ok: false,
      reason: 'write',
      failedMonths: ['2026-10'],
      categoriesFailed: false,
      restored: true,
    }
    const done = wizardReducer(base, {
      type: 'committed',
      result: failure,
      formatNote: { kind: 'saved', names: ['Bank'] },
    })
    expect(done.formatNote).toEqual({ kind: 'saved', names: ['Bank'] })
    expect(wizardReducer(done, { type: 'review-again' }).formatNote).toBeNull()
  })

  it('keeps remember and format details when a file is re-read with other settings', () => {
    const file = reparseWizardFile(savedFile(), { delimiter: ',', hasHeader: null, headerRow: null })
    expect(file.format).toEqual({ id: 'f_01', name: 'Bank' })
    expect(file.remember.name).toBe('Bank')
  })
})
