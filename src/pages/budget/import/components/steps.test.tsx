import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { buildImportPlan } from '../buildImportPlan'
import { planFromTexts } from '../../../../test/importHelpers'
import type { CommitFailure } from '../commitImport'
import { columnsBlockReason, failureMessage } from '../messages'
import type { MappingProblem } from '../mapping'
import { createWizardFile, reparseWizardFile, type WizardFile } from '../wizardFiles'
import { emptyFormatsFile } from '../savedFormats'
import ColumnsStep from './ColumnsStep'
import ResultStep from './ResultStep'
import ReviewStep from './ReviewStep'
import f01 from '../fixtures/F01-debit-credit.csv?raw'
import f02b from '../fixtures/F02b-transaction-date.csv?raw'
import f10 from '../fixtures/F10-ambiguous-dates.csv?raw'

const must = <T,>(value: T | null): T => {
  if (value === null) throw new Error('expected a value')
  return value
}

const Controlled = ({ text, fileCount = 1 }: { text: string; fileCount?: number }) => {
  const [file, setFile] = useState<WizardFile>(() => must(createWizardFile('bank.csv', text)))
  return (
    <ColumnsStep
      file={file}
      fileIndex={0}
      fileCount={fileCount}
      formats={{ state: 'ready', file: emptyFormatsFile() }}
      onRemember={remember => setFile(current => ({ ...current, remember: { ...current.remember, ...remember } }))}
      onDraft={draft => setFile(current => ({ ...current, draft }))}
      onReparse={settings => setFile(current => reparseWizardFile(current, settings))}
    />
  )
}

describe('ColumnsStep', () => {
  it('shows the file position when several files are imported', () => {
    render(<Controlled text={f02b} fileCount={3} />)
    expect(screen.getByText('File 1 of 3: bank.csv')).toBeInTheDocument()
  })

  it('previews the first rows in a labelled, focusable region', () => {
    render(<Controlled text={f02b} />)
    const region = screen.getByRole('region', { name: 'First rows of bank.csv' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(within(region).getByRole('table')).toBeInTheDocument()
  })

  it('switches to debit and credit columns', async () => {
    const user = userEvent.setup()
    render(<Controlled text={f01} />)
    expect(screen.getByRole('radio', { name: 'Separate debit and credit columns' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Money out column' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'One amount column' }))
    expect(screen.getByRole('combobox', { name: 'Amount column' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Which sign means spending?' })).toBeInTheDocument()
  })

  it('shows how an ambiguous date is read under each format', async () => {
    const user = userEvent.setup()
    render(<Controlled text={f10} />)
    await user.click(screen.getByRole('radio', { name: /MM\/DD\/YYYY/ }))
    expect(screen.getByText(/"03\/04\/2026" reads as Mar 4, 2026/)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /DD\/MM\/YYYY/ }))
    expect(screen.getByText(/"03\/04\/2026" reads as Apr 3, 2026/)).toBeInTheDocument()
  })

  it('warns when every amount has the same sign', async () => {
    const user = userEvent.setup()
    render(<Controlled text={'Date,Description,Amount\n2026-10-01,A,5.00\n2026-10-02,B,6.00'} />)
    await user.click(screen.getByRole('radio', { name: 'Negative numbers are spending' }))
    expect(
      screen.getByText('Every amount in this column is positive. Check that the sign choice is right.'),
    ).toBeInTheDocument()
  })

  it('names the column and links the error to the date select when no dates can be read', async () => {
    const user = userEvent.setup()
    render(<Controlled text={f02b} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Date column' }), 'Description')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('We could not read any dates in the "Description" column.')
    expect(screen.getByRole('combobox', { name: 'Date column' })).toHaveAccessibleDescription(
      /could not read any dates/,
    )
  })

  it('re-parses when the delimiter changes and when the header row changes', async () => {
    const user = userEvent.setup()
    render(<Controlled text={'Notes\nDate,Description,Amount\n2026-10-01,A,-5.00'} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Columns are separated by' }), ';')
    expect(screen.getByRole('combobox', { name: 'Columns are separated by' })).toHaveValue(';')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Columns are separated by' }), ',')
    const row = screen.getByRole('spinbutton', { name: 'Header row number' })
    await user.clear(row)
    await user.type(row, '2')
    expect(row).toHaveValue(2)
    await user.click(screen.getByRole('checkbox', { name: 'First row is column names' }))
    expect(screen.queryByRole('spinbutton', { name: 'Header row number' })).not.toBeInTheDocument()
  })

  it('changes the decimal mark and the category column', async () => {
    const user = userEvent.setup()
    render(<Controlled text={f02b} />)
    await user.click(screen.getByRole('radio', { name: /comma/i }))
    expect(screen.getByRole('radio', { name: /comma/i })).toBeChecked()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category column (optional)' }), 'Description')
    expect(screen.getByRole('combobox', { name: 'Category column (optional)' })).toHaveValue('1')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category column (optional)' }), 'None')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Description column' }), 'None')
    expect(screen.getByRole('combobox', { name: 'Description column' })).toHaveValue('')
  })
})

describe('ReviewStep', () => {
  const rows = Array.from(
    { length: 130 },
    (_, i) => `2026-10-${String((i % 28) + 1).padStart(2, '0')},Item ${i},-${i + 1}.00`,
  )
  const csv = ['Date,Description,Amount', ...rows, 'nope,Broken,-1.00'].join('\n')

  it('pages through long imports and filters to skipped rows', async () => {
    const user = userEvent.setup()
    const plan = planFromTexts([{ name: 'big.csv', text: csv }])
    render(<ReviewStep plan={plan} savedFormats={[]} onChangeFormat={vi.fn()} onOptions={vi.fn()} />)
    expect(screen.getByText('Rows 1 to 100 of 131')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Rows 101 to 131 of 131')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    await user.click(screen.getByRole('button', { name: '1 row could not be read' }))
    expect(screen.getByRole('button', { name: 'Skipped' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Skipped: Date not recognized')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Duplicates' }))
    expect(screen.getByText('No rows')).toBeInTheDocument()
  })

  it('lists each file and a tokenizer notice when several files are imported', () => {
    const plan = planFromTexts([
      { name: 'a.csv', text: 'Date,Description,Amount\n2026-10-01,A,-1.00' },
      { name: 'b.csv', text: 'Date,Description,Amount\n2026-10-01,A,-1.00' },
    ])
    plan.notices.push('Row 9 has an unterminated quote. It was skipped.')
    render(<ReviewStep plan={plan} savedFormats={[]} onChangeFormat={vi.fn()} onOptions={vi.fn()} />)
    const list = screen.getByRole('list', { name: 'Transactions by file' })
    expect(within(list).getByText('a.csv: 1 new, 0 duplicates, 0 could not be read')).toBeInTheDocument()
    expect(within(list).getByText('b.csv: 0 new, 1 duplicate, 0 could not be read')).toBeInTheDocument()
    expect(screen.getByText('Row 9 has an unterminated quote. It was skipped.')).toBeInTheDocument()
  })

  it('warns before replacing months that already have data and reports option changes', async () => {
    const user = userEvent.setup()
    const onOptions = vi.fn()
    const plan = planFromTexts([{ name: 'a.csv', text: 'Date,Description,Amount\n2026-10-01,A,-1.00' }], {
      existing: { '2026-10': 'Date,Category,Amount,Description\n2026-10-09,X,-2.00,Y' },
      options: { skipDuplicates: true, replaceMonths: true },
    })
    render(<ReviewStep plan={plan} savedFormats={[]} onChangeFormat={vi.fn()} onOptions={onOptions} />)
    expect(
      screen.getByText('Existing transactions in Oct 2026 will be replaced. You can undo this after importing.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Replace existing months' }))
    expect(onOptions).toHaveBeenCalledWith({ replaceMonths: false })
  })

  it('spells out the sign choice of a saved format and warns when every amount has one sign', () => {
    const plan = planFromTexts([{ name: 'a.csv', text: 'Date,Description,Amount\n2026-10-01,Coffee,-4.50\n' }])
    const savedFormats = [
      {
        index: 0,
        fileName: 'a.csv',
        name: 'bank',
        sign: 'positive-is-spending' as const,
        sameSign: 'negative' as const,
      },
    ]
    render(<ReviewStep plan={plan} savedFormats={savedFormats} onChangeFormat={vi.fn()} onOptions={vi.fn()} />)
    const inUse = screen.getByRole('list', { name: 'Saved formats in use' })
    expect(within(inUse).getByText('Positive numbers are spending')).toBeInTheDocument()
    expect(
      within(inUse).getByText('Every amount in this column is negative. Check that the sign choice is right.'),
    ).toBeInTheDocument()
  })

  it('shows no sign line for a saved format with separate debit and credit columns', () => {
    const plan = planFromTexts([{ name: 'a.csv', text: 'Date,Description,Amount\n2026-10-01,Coffee,-4.50\n' }])
    const savedFormats = [{ index: 0, fileName: 'a.csv', name: 'bank', sign: null, sameSign: null }]
    render(<ReviewStep plan={plan} savedFormats={savedFormats} onChangeFormat={vi.fn()} onOptions={vi.fn()} />)
    expect(screen.queryByText(/numbers are spending/)).not.toBeInTheDocument()
  })

  it('asks the user to check the column choices when no row could be read', () => {
    const plan = buildImportPlan({
      files: [{ name: 'a.csv', rows: [], skipped: [{ sourceRow: 2, reason: 'bad-date', raw: 'nope' }] }],
      existingCsvs: {},
      categoryGroups: [],
      options: { skipDuplicates: true, replaceMonths: false },
    })
    render(<ReviewStep plan={plan} savedFormats={[]} onChangeFormat={vi.fn()} onOptions={vi.fn()} />)
    expect(
      screen.getByText('None of the rows could be read. Go back and check the column choices.'),
    ).toBeInTheDocument()
  })
})

describe('ResultStep', () => {
  const success = {
    ok: true as const,
    imported: 1,
    months: ['2026-10'],
    newCategories: [],
    snapshotFailed: true,
    undo: { months: {}, addedCategories: [], addedYears: [] },
  }

  it('says how much was imported, warns about a missing backup and offers undo', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    render(<ResultStep formatNote={null} result={success} undone={false} undoFailed={false} canUndo onUndo={onUndo} />)
    expect(screen.getByText('Imported 1 transaction into 1 month.')).toBeInTheDocument()
    expect(screen.getByText(/A backup could not be made/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo import' }))
    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('explains why undo is unavailable and does not run it', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    render(
      <ResultStep
        formatNote={null}
        result={success}
        undone={false}
        undoFailed={false}
        canUndo={false}
        onUndo={onUndo}
      />,
    )
    expect(screen.getByText('Undo is not available because these months changed after the import.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo import' }))
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('reports a failed undo', () => {
    render(<ResultStep formatNote={null} result={success} undone={false} undoFailed canUndo onUndo={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('The import could not be undone.')
  })

  it('confirms an undo', () => {
    render(<ResultStep formatNote={null} result={success} undone undoFailed={false} canUndo={false} onUndo={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Import undone' })).toBeInTheDocument()
  })

  it('shows the failure message as an alert', () => {
    const failure: CommitFailure = {
      ok: false,
      reason: 'write',
      failedMonths: ['2026-10'],
      categoriesFailed: false,
      restored: true,
    }
    render(
      <ResultStep
        formatNote={null}
        result={failure}
        undone={false}
        undoFailed={false}
        canUndo={false}
        onUndo={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Import did not finish. Oct 2026 could not be saved. Check that the worth folder is still available, then try again.',
    )
  })
})

describe('messages', () => {
  const base: CommitFailure = {
    ok: false,
    reason: 'write',
    failedMonths: ['2026-10'],
    categoriesFailed: false,
    restored: true,
  }

  it('explains each kind of commit failure', () => {
    expect(failureMessage({ ...base, reason: 'unmergeable' })).toBe(
      'Oct 2026 already has data Worth cannot add to. Nothing was changed.',
    )
    expect(failureMessage({ ...base, categoriesFailed: true, failedMonths: [] })).toContain(
      'Your categories could not be saved.',
    )
    expect(failureMessage({ ...base, restored: false })).toContain('Some months may be partly written')
  })

  it('gives a reason for every mapping problem', () => {
    const problems: MappingProblem[] = [
      'date-column',
      'amount-column',
      'money-column',
      'sign',
      'no-dates',
      'date-format',
    ]
    for (const problem of problems) expect(columnsBlockReason(problem)).toMatch(/to continue\.$/)
  })
})
