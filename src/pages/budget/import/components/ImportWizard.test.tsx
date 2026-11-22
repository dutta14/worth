import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileStoreTestProvider } from '../../../../test/fileStoreTestUtils'
import { MemoryFileStore } from '../../../../utils/memoryFileStore'
import { useBudget } from '../../hooks/useBudget'
import { useImportWizard, type OpenRequest } from '../hooks/useImportWizard'
import type { ReadableFile } from '../readFile'
import f02b from '../fixtures/F02b-transaction-date.csv?raw'
import f05 from '../fixtures/F05-two-month-span.csv?raw'
import f10 from '../fixtures/F10-ambiguous-dates.csv?raw'
import f11 from '../fixtures/F11-legacy-canonical.csv?raw'

const asFile = (name: string, text: string): ReadableFile => {
  const bytes = new TextEncoder().encode(text)
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer }
}

interface HostProps {
  request?: OpenRequest
  onViewTransactions?: () => void
  snapshot?: () => Promise<void>
}

const Host = ({ request, onViewTransactions, snapshot }: HostProps) => {
  const budget = useBudget()
  const wizard = useImportWizard(budget, { onViewTransactions, preImportSnapshot: snapshot })
  return (
    <div>
      <h1>Budget</h1>
      <button onClick={() => wizard.open(request)}>Import</button>
      <output data-testid="months">{Object.keys(budget.store.csvs).join(',')}</output>
      {wizard.element}
    </div>
  )
}

const setup = (props: HostProps = {}, fileStore = new MemoryFileStore()) => {
  const user = userEvent.setup()
  const view = render(
    <FileStoreTestProvider store={fileStore}>
      <Host {...props} />
    </FileStoreTestProvider>,
  )
  return { user, fileStore, ...view }
}

const openWith = async (files: [string, string][]) => {
  const ui = setup({ request: { files: files.map(([name, text]) => asFile(name, text)) } })
  await ui.user.click(screen.getByRole('button', { name: 'Import' }))
  return ui
}

const chooseNegativeSpending = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('radio', { name: 'Negative numbers are spending' }))

const primary = (name: RegExp | string) => screen.getByRole('button', { name })

describe('Import wizard', () => {
  it('starts closed and opens a dialog with a loading state', async () => {
    const { user } = setup({ request: { files: [asFile('a.csv', f02b)] } })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByRole('dialog', { name: 'Import transactions' })).toBeInTheDocument()
  })

  it('walks Columns then Review, imports into the right months and shows the result', async () => {
    const { user, fileStore } = await openWith([['bank.csv', f02b]])

    expect(await screen.findByRole('heading', { name: 'Columns' })).toBeInTheDocument()
    expect(screen.getAllByText('Step 1 of 2: Columns')).toHaveLength(2)
    expect(primary('Continue to review')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Choose which sign means spending to continue.')).toBeInTheDocument()

    await chooseNegativeSpending(user)
    expect(primary('Continue to review')).toHaveAttribute('aria-disabled', 'false')
    await user.click(primary('Continue to review'))

    expect(await screen.findByRole('heading', { name: 'Review before importing' })).toBeInTheDocument()
    expect(screen.getAllByText('Step 2 of 2: Review').length).toBeGreaterThan(0)
    expect(screen.getByText(/new transactions? across 1 month/)).toBeInTheDocument()
    expect(await fileStore.listFiles('transactions/2026')).toEqual([])

    await user.click(primary(/^Import \d+ transactions?$/))
    expect(await screen.findByRole('heading', { name: 'Import complete' })).toBeInTheDocument()
    expect(await fileStore.listFiles('transactions/2026')).toEqual(['2026-10.csv'])
    const written = (await fileStore.readCSV('transactions/2026/2026-10.csv')).map(row => row.join('|'))
    expect(written[0]).toBe('Date|Category|Amount|Description')
    expect(written).toContain('2026-10-02|Uncategorized|-6.75|Starbucks')
    expect(written).toContain('2026-10-01|Uncategorized income|3200.00|Payroll Acme Corp')
    expect(screen.getByTestId('months')).toHaveTextContent('2026-10')
  })

  it('skips Columns for a legacy-shaped file and goes straight to Review', async () => {
    await openWith([['legacy.csv', f11]])
    expect(await screen.findByRole('heading', { name: 'Review before importing' })).toBeInTheDocument()
    expect(screen.getAllByText('Step 1 of 1: Review').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('keeps Continue disabled until an ambiguous date format is chosen', async () => {
    const { user } = await openWith([['ambiguous.csv', f10]])
    await screen.findByRole('heading', { name: 'Columns' })
    await chooseNegativeSpending(user)
    expect(primary('Continue to review')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Choose a date format to continue.')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /DD\/MM\/YYYY/ }))
    expect(primary('Continue to review')).toHaveAttribute('aria-disabled', 'false')
  })

  it('does not advance when a disabled Continue is clicked', async () => {
    const { user } = await openWith([['bank.csv', f02b]])
    await screen.findByRole('heading', { name: 'Columns' })
    await user.click(primary('Continue to review'))
    expect(screen.getByRole('heading', { name: 'Columns' })).toBeInTheDocument()
  })

  it('goes back from Review to Columns', async () => {
    const { user } = await openWith([['bank.csv', f02b]])
    await screen.findByRole('heading', { name: 'Columns' })
    await chooseNegativeSpending(user)
    await user.click(primary('Continue to review'))
    await screen.findByRole('heading', { name: 'Review before importing' })
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Columns' })).toBeInTheDocument()
  })

  it('moves focus to the step heading and announces the step', async () => {
    const { user } = await openWith([['bank.csv', f02b]])
    const heading = await screen.findByRole('heading', { name: 'Columns' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(within(screen.getByRole('dialog')).getAllByRole('status')[0]).toHaveTextContent('Step 1 of 2: Columns')
    await chooseNegativeSpending(user)
    await user.click(primary('Continue to review'))
    const review = await screen.findByRole('heading', { name: 'Review before importing' })
    await waitFor(() => expect(review).toHaveFocus())
  })

  it('closes on Escape without writing anything and returns focus to the opener', async () => {
    const { user, fileStore } = await openWith([['bank.csv', f02b]])
    await screen.findByRole('heading', { name: 'Columns' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await fileStore.listFiles('transactions/2026')).toEqual([])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toHaveFocus())
  })

  it('does not close when the backdrop is clicked', async () => {
    const { user, container } = await openWith([['bank.csv', f02b]])
    await screen.findByRole('heading', { name: 'Columns' })
    await user.click(container.ownerDocument.querySelector('.iw-overlay') as HTMLElement)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes with Cancel', async () => {
    const { user } = await openWith([['bank.csv', f02b]])
    await screen.findByRole('heading', { name: 'Columns' })
    expect(screen.getByText('Nothing has been saved yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the spec message and a way to pick again when a file has no rows', async () => {
    await openWith([['blank.csv', '\n\n']])
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We found no transactions in blank.csv. Check the header row setting, or choose another file.',
    )
    expect(screen.getByRole('button', { name: 'Choose another file' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('opens the file picker when no files are passed and imports what is chosen', async () => {
    const { user } = setup()
    const input = screen.getByTestId('import-wizard-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(click).toHaveBeenCalled()
    expect(input.multiple).toBe(false)
    const file = new File([f11], 'legacy.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(f11).buffer })
    await user.upload(input, file)
    expect(await screen.findByRole('heading', { name: 'Review before importing' })).toBeInTheDocument()
  })

  it('accepts CSV text handed over by another tool', async () => {
    const { user } = setup({ request: { text: f11, name: 'from-pdf.csv' } })
    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByRole('heading', { name: 'Review before importing' })).toBeInTheDocument()
  })

  it('shows a month-by-month summary for a file that spans two months', async () => {
    const { user } = await openWith([['span.csv', f05]])
    await screen.findByRole('heading', { name: 'Columns' })
    await chooseNegativeSpending(user)
    await user.click(primary('Continue to review'))
    const list = await screen.findByRole('list', { name: 'Transactions by month' })
    expect(within(list).getByText(/Oct 2026: \d+ new, 0 skipped as duplicates/)).toBeInTheDocument()
    expect(within(list).getByText(/Nov 2026: \d+ new, 0 skipped as duplicates/)).toBeInTheDocument()
  })

  it('skips duplicates on a second import and disables the import button when nothing is new', async () => {
    const { user, fileStore } = await openWith([['legacy.csv', f11]])
    await user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
    await screen.findByRole('heading', { name: 'Import complete' })
    const before = await fileStore.readCSV('transactions/2026/2026-10.csv')
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await user.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByRole('heading', { name: 'Review before importing' })
    expect(screen.getByText('Nothing new to import. Every transaction is already in your budget.')).toBeInTheDocument()
    const importButton = screen.getByRole('button', { name: 'Import 0 transactions' })
    expect(importButton).toHaveAttribute('aria-disabled', 'true')
    await user.click(importButton)
    expect(screen.getByRole('heading', { name: 'Review before importing' })).toBeInTheDocument()
    expect(await fileStore.readCSV('transactions/2026/2026-10.csv')).toEqual(before)
  })

  it('undoes an import and removes the month it created', async () => {
    const { user, fileStore } = await openWith([['legacy.csv', f11]])
    await user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
    await screen.findByRole('heading', { name: 'Import complete' })
    await user.click(screen.getByRole('button', { name: 'Undo import' }))
    expect(await screen.findByRole('heading', { name: 'Import undone' })).toBeInTheDocument()
    expect(screen.getAllByText('Import undone. Your budget is back to how it was.').length).toBeGreaterThan(0)
    expect(await fileStore.listFiles('transactions/2026')).toEqual([])
    expect(screen.getByTestId('months')).toHaveTextContent('')
  })

  it('offers View in Transactions and closes the wizard when it is used', async () => {
    const onViewTransactions = vi.fn()
    const ui = setup({ request: { files: [asFile('legacy.csv', f11)] }, onViewTransactions })
    await ui.user.click(screen.getByRole('button', { name: 'Import' }))
    await ui.user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
    await ui.user.click(await screen.findByRole('button', { name: 'View in Transactions' }))
    expect(onViewTransactions).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('surfaces a failed write, leaves the month as it was, and lets the user try again', async () => {
    const fileStore = new MemoryFileStore()
    const original = fileStore.writeCSV.bind(fileStore)
    let failing = true
    vi.spyOn(fileStore, 'writeCSV').mockImplementation(async (path, rows) => {
      if (failing && path.endsWith('2026-10.csv') && rows.length > 0) {
        failing = false
        throw new Error('disk full')
      }
      return original(path, rows)
    })
    const user = userEvent.setup()
    render(
      <FileStoreTestProvider store={fileStore}>
        <Host request={{ files: [asFile('legacy.csv', f11)] }} />
      </FileStoreTestProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Import did not finish.')
    expect(alert).toHaveTextContent('Oct 2026 could not be saved')
    expect(await fileStore.listFiles('transactions/2026')).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
    expect(await screen.findByRole('heading', { name: 'Import complete' })).toBeInTheDocument()
    expect(await fileStore.listFiles('transactions/2026')).toEqual(['2026-10.csv'])
  })

  it('calls the pre-import snapshot port before writing', async () => {
    const snapshot = vi.fn().mockResolvedValue(undefined)
    const ui = setup({ request: { files: [asFile('legacy.csv', f11)] }, snapshot })
    await ui.user.click(screen.getByRole('button', { name: 'Import' }))
    await ui.user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
    await screen.findByRole('heading', { name: 'Import complete' })
    expect(snapshot).toHaveBeenCalledWith('import')
  })

  it('lets the user switch off duplicate skipping and warns about it', async () => {
    const { user } = await openWith([['legacy.csv', f11]])
    await screen.findByRole('heading', { name: 'Review before importing' })
    await user.click(screen.getByRole('checkbox', { name: 'Skip duplicates' }))
    expect(screen.getByText('Turning this off will count matching transactions twice.')).toBeInTheDocument()
  })
})
