import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileStoreTestProvider } from '../../../../test/fileStoreTestUtils'
import { containsRule } from '../../../../test/importHelpers'
import { MemoryFileStore } from '../../../../utils/memoryFileStore'
import { useBudget } from '../../hooks/useBudget'
import { useImportWizard } from '../hooks/useImportWizard'
import { loadRules, RULES_PATH } from '../importStorage'
import type { ReadableFile } from '../readFile'
import type { CategoryRule } from '../rules'
import f02b from '../fixtures/F02b-transaction-date.csv?raw'

const asFile = (name: string, text: string): ReadableFile => {
  const bytes = new TextEncoder().encode(text)
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer }
}

const Host = () => {
  const budget = useBudget()
  const wizard = useImportWizard(budget)
  return (
    <div>
      <h1>Budget</h1>
      <button onClick={() => wizard.open({ files: [asFile('bank.csv', f02b)] })}>Import</button>
      <output data-testid="october">{budget.store.csvs['2026-10']?.csv ?? ''}</output>
      {wizard.element}
    </div>
  )
}

const seededStore = async (rules?: unknown) => {
  const store = new MemoryFileStore()
  await store.writeJSON('budget/categories.json', {
    version: 1,
    years: [],
    categoryGroups: [{ id: 'food', name: 'Food', categories: ['Dining', 'Gas'] }],
  })
  if (rules !== undefined) await store.writeJSON(RULES_PATH, rules)
  return store
}

const rulesFile = (rules: CategoryRule[]) => ({ schemaVersion: 1, rules })

type User = ReturnType<typeof userEvent.setup>

async function toReview(store: MemoryFileStore) {
  const user = userEvent.setup()
  render(
    <FileStoreTestProvider store={store}>
      <Host />
    </FileStoreTestProvider>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Import' }))
  await screen.findByRole('heading', { name: 'Columns' })
  await user.click(screen.getByRole('radio', { name: 'Negative numbers are spending' }))
  await user.click(screen.getByRole('button', { name: 'Continue to review' }))
  await screen.findByRole('heading', { name: 'Review before importing' })
  return user
}

const importNow = async (user: User) => {
  await user.click(screen.getByRole('button', { name: /^Import \d+ transactions?$/ }))
  await screen.findByRole('heading', { name: 'Import complete' })
}

describe('Import wizard rules', () => {
  it('sorts matching rows into the rule category, says so in Review and writes them there', async () => {
    const store = await seededStore(rulesFile([containsRule('r_01', 'STARBUCKS', 'Dining')]))
    const user = await toReview(store)

    expect(screen.getByText('1 transaction sorted by your rules')).toBeInTheDocument()
    expect(screen.getByText('2 transactions will go to Uncategorized')).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /Starbucks/ })
    expect(within(row).getByText('Dining')).toBeInTheDocument()
    expect(document.querySelector('.iw-live')).toHaveTextContent('1 transaction sorted by your rules.')

    await importNow(user)
    expect(screen.getByTestId('october').textContent).toMatch(/Dining,-6\.75,Starbucks/)
  })

  it('does nothing and shows no rules line when there are no rules', async () => {
    const user = await toReview(await seededStore())
    expect(screen.queryByText(/sorted by your rules/)).not.toBeInTheDocument()
    expect(screen.getByText('3 transactions will go to Uncategorized')).toBeInTheDocument()
    await importNow(user)
  })

  it('reports a rule skipped because its category no longer exists, in Review and in the Result', async () => {
    const store = await seededStore(rulesFile([containsRule('r_01', 'STARBUCKS', 'Vanished')]))
    const user = await toReview(store)
    expect(screen.getByText('1 rule skipped because the category no longer exists.')).toBeInTheDocument()
    expect(screen.queryByText(/sorted by your rules/)).not.toBeInTheDocument()

    await importNow(user)
    expect(screen.getByText('1 rule skipped because the category no longer exists.')).toBeInTheDocument()
    expect(screen.getByTestId('october').textContent).not.toContain('Vanished')
  })

  it('adds a rule from Review, updates the plan, and keeps the wizard open on Escape from the dialog', async () => {
    const store = await seededStore()
    const user = await toReview(store)
    const manage = screen.getByRole('button', { name: 'Manage rules' })
    await user.click(manage)

    const dialog = await screen.findByRole('dialog', { name: 'Categorization rules' })
    expect(screen.getByRole('heading', { name: 'Categorization rules' })).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Import transactions', hidden: true }).parentElement).toHaveAttribute(
      'inert',
    )

    await user.type(within(dialog).getByLabelText('Description contains'), 'shell oil')
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'Gas')
    await user.click(within(dialog).getByRole('button', { name: 'Add rule' }))
    await within(dialog).findByText(/^Rule saved: /, { selector: '[role="status"]' })

    const saved = await loadRules(store)
    expect(saved.state === 'ready' && saved.file.rules).toEqual([containsRule('r_01', 'shell oil', 'Gas')])

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Categorization rules' })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'Import transactions' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Import transactions' }).parentElement).not.toHaveAttribute('inert')
    expect(screen.getByText('1 transaction sorted by your rules')).toBeInTheDocument()
    expect(manage).toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes the rules dialog with Done and leaves the wizard where it was', async () => {
    const user = await toReview(await seededStore())
    await user.click(screen.getByRole('button', { name: 'Manage rules' }))
    await user.click(await screen.findByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog', { name: 'Categorization rules' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review before importing' })).toBeInTheDocument()
  })

  it.each([
    [
      'corrupt',
      'garbage',
      'Your rules file could not be read, so rules are off for this import. The file has not been changed.',
    ],
    [
      'newer',
      { schemaVersion: 4, rules: [] },
      'Your rules file was saved by a newer version of Worth, so rules are off for this import. The file is left as it is.',
    ],
  ])('warns about a %s rules file, still imports and never overwrites it', async (_, content, message) => {
    const store = await seededStore(content)
    const user = await toReview(store)
    expect(screen.getAllByText(message).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Manage rules' }))
    const dialog = await screen.findByRole('dialog', { name: 'Categorization rules' })
    expect(within(dialog).queryByRole('button', { name: 'Add rule' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    await importNow(user)
    expect(await store.readJSON(RULES_PATH, null)).toEqual(content)
  })

  it('does not read the rules file for a wizard that was never opened', async () => {
    const store = await seededStore(rulesFile([]))
    let reads = 0
    const readJSON = store.readJSON.bind(store)
    store.readJSON = (async (path: string, fallback: unknown) => {
      if (path === RULES_PATH) reads++
      return readJSON(path, fallback)
    }) as typeof store.readJSON
    render(
      <FileStoreTestProvider store={store}>
        <Host />
      </FileStoreTestProvider>,
    )
    await screen.findByRole('button', { name: 'Import' })
    expect(reads).toBe(0)
  })
})
