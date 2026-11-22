import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileStoreTestProvider } from '../../../../test/fileStoreTestUtils'
import { MemoryFileStore } from '../../../../utils/memoryFileStore'
import { useBudget } from '../../hooks/useBudget'
import { useImportWizard } from '../hooks/useImportWizard'
import { FORMATS_PATH } from '../importStorage'
import type { ReadableFile } from '../readFile'
import { parseFormatsFile, type FormatsFile } from '../savedFormats'
import f01 from '../fixtures/F01-debit-credit.csv?raw'
import f02b from '../fixtures/F02b-transaction-date.csv?raw'
import f10 from '../fixtures/F10-ambiguous-dates.csv?raw'
import f11 from '../fixtures/F11-legacy-canonical.csv?raw'

const asFile = (name: string, text: string): ReadableFile => {
  const bytes = new TextEncoder().encode(text)
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer }
}

const Host = ({ files }: { files: [string, string][] }) => {
  const budget = useBudget()
  const wizard = useImportWizard(budget)
  return (
    <div>
      <h1>Budget</h1>
      <button onClick={() => wizard.open({ files: files.map(([name, text]) => asFile(name, text)) })}>Import</button>
      {wizard.element}
    </div>
  )
}

const setup = (files: [string, string][], store = new MemoryFileStore()) => {
  const user = userEvent.setup()
  const view = render(
    <FileStoreTestProvider store={store}>
      <Host files={files} />
    </FileStoreTestProvider>,
  )
  return { user, store, ...view }
}

type User = ReturnType<typeof userEvent.setup>

const openImport = (user: User) => user.click(screen.getByRole('button', { name: 'Import' }))
const primary = (name: RegExp | string) => screen.getByRole('button', { name })
const chooseNegative = (user: User) => user.click(screen.getByRole('radio', { name: 'Negative numbers are spending' }))

/** Maps the "Transaction Date, Description, Amount" fixture and imports it. */
async function importFirstFile(user: User) {
  await openImport(user)
  await screen.findByRole('heading', { name: 'Columns' })
  await chooseNegative(user)
  await user.click(primary('Continue to review'))
  await screen.findByRole('heading', { name: 'Review before importing' })
  await user.click(primary(/^Import \d+ transactions?$/))
  await screen.findByRole('heading', { name: 'Import complete' })
}

const readFormats = async (store: MemoryFileStore): Promise<FormatsFile> => {
  const parsed = parseFormatsFile(await store.readJSON(FORMATS_PATH, null))
  if (parsed.kind !== 'ok') throw new Error('formats file not readable')
  return parsed.file
}

const secondStatement = f02b.replaceAll('2026-10', '2026-11')

describe('Import wizard saved formats', () => {
  it('does not read or write the formats file until the wizard is opened', async () => {
    const store = new MemoryFileStore()
    const read = vi.spyOn(store, 'readJSON')
    const exists = vi.spyOn(store, 'exists')
    const write = vi.spyOn(store, 'writeJSON')
    setup([['bank.csv', f02b]], store)
    await Promise.resolve()
    const touched = [...read.mock.calls, ...exists.mock.calls, ...write.mock.calls].map(call => call[0])
    expect(touched).not.toContain(FORMATS_PATH)
  })

  it('shows the first-time intro and a checked "Remember this format as" field named after the file', async () => {
    const { user } = setup([['Checking-2026-10.csv', f02b]])
    await openImport(user)
    await screen.findByRole('heading', { name: 'Columns' })
    expect(screen.getByText('Choose which column holds each value. Worth remembers your choices.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Remember this format as' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Format name' })).toHaveValue('Checking')
  })

  it('writes nothing about the format until the import is confirmed, then saves it', async () => {
    const { user, store } = setup([['bank.csv', f02b]])
    await openImport(user)
    await screen.findByRole('heading', { name: 'Columns' })
    await chooseNegative(user)
    await user.click(primary('Continue to review'))
    await screen.findByRole('heading', { name: 'Review before importing' })
    expect(await store.exists(FORMATS_PATH)).toBe(false)

    await user.click(primary(/^Import \d+ transactions?$/))
    await screen.findByRole('heading', { name: 'Import complete' })
    expect(screen.getByText('Saved format: bank.')).toBeInTheDocument()
    const file = await readFormats(store)
    expect(file.mappings).toHaveLength(1)
    expect(file.mappings[0]).toMatchObject({
      name: 'bank',
      headerSignature: 'transaction date|description|amount',
      columns: { date: 'Transaction Date', description: 'Description', amount: 'Amount' },
      signConvention: 'negative-is-spending',
      dateFormat: 'YYYY-MM-DD',
    })
  })

  it('saves under the name the user typed', async () => {
    const { user, store } = setup([['bank.csv', f02b]])
    await openImport(user)
    await screen.findByRole('heading', { name: 'Columns' })
    const name = screen.getByRole('textbox', { name: 'Format name' })
    await user.clear(name)
    await user.type(name, '  Joint   checking ')
    await chooseNegative(user)
    await user.click(primary('Continue to review'))
    await user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
    await screen.findByRole('heading', { name: 'Import complete' })
    expect((await readFormats(store)).mappings[0].name).toBe('Joint checking')
  })

  it('does not save when "Remember this format as" is unchecked', async () => {
    const { user, store } = setup([['bank.csv', f02b]])
    await openImport(user)
    await screen.findByRole('heading', { name: 'Columns' })
    await user.click(screen.getByRole('checkbox', { name: 'Remember this format as' }))
    expect(screen.getByRole('textbox', { name: 'Format name' })).toBeDisabled()
    await chooseNegative(user)
    await user.click(primary('Continue to review'))
    await user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
    await screen.findByRole('heading', { name: 'Import complete' })
    expect(await store.exists(FORMATS_PATH)).toBe(false)
    expect(screen.queryByText(/Saved format/)).not.toBeInTheDocument()
  })

  it('skips the Columns step for the next file with the same headers and shows the saved format chip', async () => {
    const { user, store, unmount } = setup([['bank.csv', f02b]])
    await importFirstFile(user)
    unmount()

    const second = setup([['bank-nov.csv', secondStatement]], store)
    await openImport(second.user)
    const review = await screen.findByRole('heading', { name: 'Review before importing' })
    await waitFor(() => expect(review).toHaveFocus())
    expect(screen.queryByRole('heading', { name: 'Columns' })).not.toBeInTheDocument()
    expect(screen.getByText('Using saved format: bank')).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Saved formats in use' })).getByText('Negative numbers are spending'),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/Step 1 of 1: Review/).length).toBeGreaterThan(0)
    expect(within(screen.getByRole('dialog')).getAllByRole('status')[0]).toHaveTextContent('Using saved format: bank.')
    expect(screen.getByText(/3 new transactions across 1 month/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()

    await second.user.click(primary(/^Import \d+ transactions?$/))
    await screen.findByRole('heading', { name: 'Import complete' })
    expect(screen.queryByText(/Saved format:/)).not.toBeInTheDocument()
    const written = (await store.readCSV('transactions/2026/2026-11.csv')).map(row => row.join('|'))
    expect(written).toContain('2026-11-02|Uncategorized|-6.75|Starbucks')
    expect((await readFormats(store)).mappings).toHaveLength(1)
  })

  it('applies a saved format to an export with the columns in a different order', async () => {
    const { user, store, unmount } = setup([['bank.csv', f02b]])
    await importFirstFile(user)
    unmount()

    const reordered = ['Amount,Transaction Date,Description', '-12.00,2026-12-01,Pharmacy'].join('\n')
    const second = setup([['bank-dec.csv', reordered]], store)
    await openImport(second.user)
    await screen.findByRole('heading', { name: 'Review before importing' })
    await second.user.click(primary('Import 1 transaction'))
    await screen.findByRole('heading', { name: 'Import complete' })
    const written = (await store.readCSV('transactions/2026/2026-12.csv')).map(row => row.join('|'))
    expect(written).toContain('2026-12-01|Uncategorized|-12.00|Pharmacy')
  })

  it('opens the Columns step prefilled when the user presses Change, and Back returns to the saved format', async () => {
    const { user, store, unmount } = setup([['bank.csv', f02b]])
    await importFirstFile(user)
    unmount()

    const second = setup([['bank-nov.csv', secondStatement]], store)
    await openImport(second.user)
    await screen.findByRole('heading', { name: 'Review before importing' })
    await second.user.click(screen.getByRole('button', { name: 'Change' }))

    const columns = await screen.findByRole('heading', { name: 'Columns' })
    await waitFor(() => expect(columns).toHaveFocus())
    expect(screen.getAllByText('Step 1 of 2: Columns').length).toBeGreaterThan(0)
    expect(screen.getByRole('radio', { name: 'Negative numbers are spending' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Format name' })).toHaveValue('bank')
    expect(screen.getByText('Choose which column holds each value.')).toBeInTheDocument()
    expect(screen.queryByText(/Worth remembers your choices/)).not.toBeInTheDocument()

    await second.user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Review before importing' })).toBeInTheDocument()
    expect(screen.getByText('Using saved format: bank')).toBeInTheDocument()
  })

  it('updates the same saved format when the user changes it and confirms', async () => {
    const { user, store, unmount } = setup([['bank.csv', f02b]])
    await importFirstFile(user)
    const before = (await readFormats(store)).mappings[0]
    unmount()

    const second = setup([['bank-nov.csv', secondStatement]], store)
    await openImport(second.user)
    await screen.findByRole('heading', { name: 'Review before importing' })
    await second.user.click(screen.getByRole('button', { name: 'Change' }))
    await screen.findByRole('heading', { name: 'Columns' })
    await second.user.click(screen.getByRole('radio', { name: 'Positive numbers are spending' }))
    const name = screen.getByRole('textbox', { name: 'Format name' })
    await second.user.clear(name)
    await second.user.type(name, 'Bank v2')
    await second.user.click(primary('Continue to review'))
    await second.user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
    await screen.findByRole('heading', { name: 'Import complete' })

    const after = await readFormats(store)
    expect(after.mappings).toHaveLength(1)
    expect(after.mappings[0]).toMatchObject({ id: before.id, name: 'Bank v2', signConvention: 'positive-is-spending' })
    expect(screen.getByText('Saved format: Bank v2.')).toBeInTheDocument()
  })

  it('shows the short intro when saved formats exist but none matches this file', async () => {
    const { user, store, unmount } = setup([['bank.csv', f02b]])
    await importFirstFile(user)
    unmount()

    const other = setup([['card.csv', f01]], store)
    await openImport(other.user)
    await screen.findByRole('heading', { name: 'Columns' })
    expect(screen.getByText('Choose which column holds each value.')).toBeInTheDocument()
    expect(screen.queryByText(/Worth remembers/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Using saved format/)).not.toBeInTheDocument()
  })

  it('lets a legacy-shaped file skip the Columns step without a saved format', async () => {
    const { user, store } = setup([['legacy.csv', f11]])
    await openImport(user)
    await screen.findByRole('heading', { name: 'Review before importing' })
    expect(screen.queryByText(/Using saved format/)).not.toBeInTheDocument()
    await user.click(primary(/^Import \d+ transactions?$/))
    await screen.findByRole('heading', { name: 'Import complete' })
    expect(await store.exists(FORMATS_PATH)).toBe(false)
  })

  it('remembers one format for a batch of files with the same headers', async () => {
    const { user, store } = setup([
      ['oct.csv', f02b],
      ['nov.csv', secondStatement],
    ])
    await openImport(user)
    await screen.findByRole('heading', { name: 'Columns' })
    await chooseNegative(user)
    await user.click(primary('Continue'))
    await user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
    await screen.findByRole('heading', { name: 'Import complete' })
    expect((await readFormats(store)).mappings.map(f => f.name)).toEqual(['oct'])
  })

  it('names the file on each Change button when several files use saved formats', async () => {
    const { user, store, unmount } = setup([['bank.csv', f02b]])
    await importFirstFile(user)
    unmount()

    const batch = setup(
      [
        ['nov.csv', secondStatement],
        ['dec.csv', f02b.replaceAll('2026-10', '2026-12')],
      ],
      store,
    )
    await openImport(batch.user)
    await screen.findByRole('heading', { name: 'Review before importing' })
    const inUse = screen.getByRole('list', { name: 'Saved formats in use' })
    expect(within(inUse).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Change saved format for dec.csv' })).toBeInTheDocument()
    await batch.user.click(screen.getByRole('button', { name: 'Change saved format for dec.csv' }))
    expect(await screen.findByRole('heading', { name: 'Columns' })).toBeInTheDocument()
    expect(screen.getByText('File 2 of 2: dec.csv')).toBeInTheDocument()
  })

  describe('with a saved formats file that cannot be used', () => {
    it('warns, hides the remember field, imports, and leaves a corrupt file untouched', async () => {
      const store = new MemoryFileStore()
      await store.writeBinary(FORMATS_PATH, new ArrayBuffer(8))
      const { user } = setup([['bank.csv', f02b]], store)
      await openImport(user)
      await screen.findByRole('heading', { name: 'Columns' })
      expect(
        screen.getByText(
          'Your saved formats file could not be read. You can still map columns by hand. The file has not been changed.',
        ),
      ).toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: 'Remember this format as' })).not.toBeInTheDocument()
      expect(screen.queryByText(/Worth remembers/)).not.toBeInTheDocument()

      await chooseNegative(user)
      await user.click(primary('Continue to review'))
      await user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
      expect(await screen.findByRole('heading', { name: 'Import complete' })).toBeInTheDocument()
      expect(await store.readJSON(FORMATS_PATH, 'unreadable')).toBe('unreadable')
      expect(await store.readBinary(FORMATS_PATH)).not.toBeNull()
    })

    it('says so and keeps a newer-version file exactly as it is', async () => {
      const store = new MemoryFileStore()
      const newer = { schemaVersion: 2, mappings: [{ shape: 'unknown' }] }
      await store.writeJSON(FORMATS_PATH, newer)
      const { user } = setup([['bank.csv', f02b]], store)
      await openImport(user)
      await screen.findByRole('heading', { name: 'Columns' })
      expect(
        screen.getByText('Your saved formats file was saved by a newer version of Worth. It is left as it is.'),
      ).toBeInTheDocument()
      await chooseNegative(user)
      await user.click(primary('Continue to review'))
      await user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
      await screen.findByRole('heading', { name: 'Import complete' })
      expect(await store.readJSON(FORMATS_PATH, null)).toEqual(newer)
    })

    it('does not overwrite a file that became unreadable while the wizard was open', async () => {
      const { user, store } = setup([['bank.csv', f02b]])
      await openImport(user)
      await screen.findByRole('heading', { name: 'Columns' })
      await chooseNegative(user)
      await user.click(primary('Continue to review'))
      await screen.findByRole('heading', { name: 'Review before importing' })
      const newer = { schemaVersion: 3, mappings: [] }
      await store.writeJSON(FORMATS_PATH, newer)
      await user.click(primary(/^Import \d+ transactions?$/))
      await screen.findByRole('heading', { name: 'Import complete' })
      expect(
        screen.getByText(
          'Your import went through. The format was not saved because your saved formats file could not be read. The file has not been changed.',
        ),
      ).toBeInTheDocument()
      expect(await store.readJSON(FORMATS_PATH, null)).toEqual(newer)
    })
  })

  it('reports a failed format write next to a successful import', async () => {
    const { user, store } = setup([['bank.csv', f02b]])
    await openImport(user)
    await screen.findByRole('heading', { name: 'Columns' })
    await chooseNegative(user)
    await user.click(primary('Continue to review'))
    await screen.findByRole('heading', { name: 'Review before importing' })
    const write = store.writeJSON.bind(store)
    store.writeJSON = async (path, data) => {
      if (path === FORMATS_PATH) throw new Error('disk full')
      return write(path, data)
    }
    await user.click(primary(/^Import \d+ transactions?$/))
    expect(await screen.findByRole('heading', { name: 'Import complete' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Your import went through, but the format could not be saved. Check that the worth folder is still available.',
      ),
    ).toBeInTheDocument()
    expect(await store.listFiles('transactions/2026')).toEqual(['2026-10.csv'])
  })

  it('leaves the formats file alone on Escape', async () => {
    const { user, store } = setup([['bank.csv', f02b]])
    await openImport(user)
    await screen.findByRole('heading', { name: 'Columns' })
    await chooseNegative(user)
    await user.click(primary('Continue to review'))
    await screen.findByRole('heading', { name: 'Review before importing' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await store.exists(FORMATS_PATH)).toBe(false)
  })

  describe('keyboard', () => {
    it('toggles remembering with Space and reaches Change with Tab and activates it with Enter', async () => {
      const { user, store, unmount } = setup([['bank.csv', f02b]])
      await openImport(user)
      await screen.findByRole('heading', { name: 'Columns' })
      const remember = screen.getByRole('checkbox', { name: 'Remember this format as' })
      remember.focus()
      await user.keyboard(' ')
      expect(remember).not.toBeChecked()
      await user.keyboard(' ')
      expect(remember).toBeChecked()
      await user.tab()
      expect(screen.getByRole('textbox', { name: 'Format name' })).toHaveFocus()
      await chooseNegative(user)
      await user.click(primary('Continue to review'))
      await user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
      await screen.findByRole('heading', { name: 'Import complete' })
      unmount()

      const second = setup([['bank-nov.csv', secondStatement]], store)
      await openImport(second.user)
      const review = await screen.findByRole('heading', { name: 'Review before importing' })
      await waitFor(() => expect(review).toHaveFocus())
      await second.user.tab()
      expect(screen.getByRole('button', { name: 'Change' })).toHaveFocus()
      await second.user.keyboard('{Enter}')
      const columns = await screen.findByRole('heading', { name: 'Columns' })
      await waitFor(() => expect(columns).toHaveFocus())
      await second.user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })
  })

  it('does not save a format for ambiguous dates until the user has chosen the date format', async () => {
    const { user, store } = setup([['ambiguous.csv', f10]])
    await openImport(user)
    await screen.findByRole('heading', { name: 'Columns' })
    await chooseNegative(user)
    expect(primary('Continue to review')).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('radio', { name: /DD\/MM\/YYYY/ }))
    await user.click(primary('Continue to review'))
    await user.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
    await screen.findByRole('heading', { name: 'Import complete' })
    expect((await readFormats(store)).mappings[0].dateFormat).toBe('DD/MM/YYYY')
  })
})
