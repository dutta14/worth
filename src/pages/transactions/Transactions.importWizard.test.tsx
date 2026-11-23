import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FileStoreTestProvider } from '../../test/fileStoreTestUtils'
import { containsRule } from '../../test/importHelpers'
import { parseCSV } from '../../utils/csvUtils'
import { MemoryFileStore } from '../../utils/memoryFileStore'
import { RULES_PATH } from '../budget/import/importStorage'
import Transactions, { resetTransactionCache } from './Transactions'

const menuItem = (name: string): HTMLElement => {
  const toggle = screen.getByRole('button', { name: 'More actions' })
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle)
  return screen.getByRole('menuitem', { name })
}

const OCT = [
  'Date,Category,Amount,Description',
  '2026-10-01,Uncategorized,-4.50,STARBUCKS #1',
  '2026-10-02,Dining,-9.00,Blue Bottle',
].join('\n')

const seed = async (withMonth = true) => {
  const fileStore = new MemoryFileStore()
  if (withMonth) await fileStore.writeCSV('transactions/2026/2026-10.csv', parseCSV(OCT))
  await fileStore.writeJSON('budget/categories.json', {
    version: 1,
    years: [2026],
    categoryGroups: [
      { id: 'food', name: 'Food', categories: ['Dining', 'Groceries'] },
      { id: 'others', name: 'Others', categories: ['Uncategorized'] },
    ],
  })
  await fileStore.writeJSON(RULES_PATH, { schemaVersion: 1, rules: [containsRule('r_01', 'starbucks', 'Dining')] })
  return fileStore
}

const renderPage = (fileStore: MemoryFileStore) =>
  render(
    <FileStoreTestProvider store={fileStore}>
      <MemoryRouter initialEntries={['/transactions?from=2026-10-01&to=2026-10-31']}>
        <Transactions />
      </MemoryRouter>
    </FileStoreTestProvider>,
  )

beforeEach(() => {
  resetTransactionCache()
  localStorage.clear()
})

describe('Transactions import tools', () => {
  it('keeps Import, Apply rules and Rules in one More actions menu', async () => {
    const user = userEvent.setup()
    renderPage(await seed())
    await screen.findByRole('button', { name: 'More actions' })
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument()
    expect(menuItem('Import')).toBeInTheDocument()
    expect(menuItem('Apply rules to uncategorized')).toBeInTheDocument()
    expect(menuItem('Rules')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus()
  })

  it('shows the import empty copy when there are no transactions', async () => {
    renderPage(await seed(false))
    expect(await screen.findByText('Import a CSV to see transactions here.')).toBeInTheDocument()
  })

  it('offers a rule from the category editor, creates it and returns focus to the row', async () => {
    const user = userEvent.setup()
    const fileStore = await seed()
    renderPage(fileStore)
    const trigger = await screen.findByRole('button', { name: /Edit category for Blue Bottle/i })
    await user.click(trigger)

    await user.click(screen.getByRole('button', { name: 'Always categorize merchants like this as Dining' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create a rule' })
    expect(within(dialog).getByLabelText('Description contains')).toHaveValue('Blue Bottle')
    expect(within(dialog).getByLabelText('Category')).toHaveValue('Dining')

    await user.click(within(dialog).getByRole('button', { name: 'Create rule' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create a rule' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    const file = await fileStore.readJSON<{ rules: { match: { value: string } }[] } | null>(RULES_PATH, null)
    expect(file?.rules.map(rule => rule.match.value)).toEqual(['starbucks', 'Blue Bottle'])
  })

  it('leaves the category empty in the rule dialog for an uncategorized row', async () => {
    const user = userEvent.setup()
    renderPage(await seed())
    await user.click(await screen.findByRole('button', { name: /Edit category for STARBUCKS/i }))
    await user.click(screen.getByRole('button', { name: 'Always categorize merchants like this as…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create a rule' })
    expect(within(dialog).getByLabelText('Category')).toHaveValue('')
  })

  it('applies the rules to uncategorized rows and shows the new category', async () => {
    const user = userEvent.setup()
    renderPage(await seed())
    await screen.findByRole('button', { name: 'More actions' })
    await user.click(menuItem('Apply rules to uncategorized'))
    await user.click(await screen.findByRole('button', { name: 'Apply rules' }))
    await screen.findByRole('heading', { name: 'Rules applied' })
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Edit category for STARBUCKS/i })).toHaveTextContent('Dining'),
    )
  })
  it('selects the categories of the first import into a page that had no transactions', async () => {
    const fileStore = await seed(false)
    renderPage(fileStore)
    await screen.findByText('Import a CSV to see transactions here.')

    await fileStore.writeCSV('transactions/2026/2026-10.csv', parseCSV(OCT))
    await fileStore.writeJSON('budget/categories.json', {
      version: 1,
      years: [2026],
      categoryGroups: [{ id: 'food', name: 'Food', categories: ['Dining', 'Uncategorized'] }],
    })

    expect(await screen.findByRole('button', { name: /Edit category for Blue Bottle/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Category\s*All Categories/ })).toBeInTheDocument()
  })

  it('keeps a row visible when a rule moves it into a category the page had not listed', async () => {
    const user = userEvent.setup()
    const fileStore = await seed(false)
    await fileStore.writeCSV(
      'transactions/2026/2026-10.csv',
      parseCSV('Date,Category,Amount,Description\n2026-10-01,Uncategorized,-4.50,STARBUCKS #1'),
    )
    renderPage(fileStore)
    await screen.findByRole('button', { name: /Edit category for STARBUCKS/i })
    await user.click(menuItem('Apply rules to uncategorized'))
    await user.click(await screen.findByRole('button', { name: 'Apply rules' }))
    await screen.findByRole('heading', { name: 'Rules applied' })
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Edit category for STARBUCKS/i })).toHaveTextContent('Dining'),
    )
  })

  it('moves the category editor up when it would run past the bottom of the viewport', async () => {
    const user = userEvent.setup()
    renderPage(await seed())
    const trigger = await screen.findByRole('button', { name: /Edit category for Blue Bottle/i })
    const bottom = window.innerHeight + 120
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const editor = this.classList.contains('txn-category-editor')
      const top = editor ? Number.parseFloat(this.style.top || '0') : 0
      return {
        top,
        bottom: editor ? top + (bottom - 300) : 300,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    })
    try {
      await user.click(trigger)
      const editor = await screen.findByRole('dialog', { name: /Edit category for Blue Bottle/i })
      await waitFor(() => expect(Number.parseFloat(editor.style.top)).toBeLessThan(308))
      expect(editor.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight - 8)
    } finally {
      rect.mockRestore()
    }
  })
})
