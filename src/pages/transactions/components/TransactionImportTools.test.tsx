import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileStoreTestProvider } from '../../../test/fileStoreTestUtils'
import { containsRule } from '../../../test/importHelpers'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import { parseCSV } from '../../../utils/csvUtils'
import { RULES_PATH } from '../../budget/import/importStorage'
import TransactionImportTools, { type RuleSource } from './TransactionImportTools'

const OCT = [
  'Date,Category,Amount,Description',
  '2026-10-01,Uncategorized,-4.50,STARBUCKS #1',
  '2026-10-02,Uncategorized,-30.00,KROGER 55',
  '2026-10-03,Dining,-9.00,STARBUCKS #2',
].join('\n')

const seed = async (rules = true) => {
  const fileStore = new MemoryFileStore()
  await fileStore.writeCSV('transactions/2026/2026-10.csv', parseCSV(OCT))
  await fileStore.writeJSON('budget/categories.json', {
    version: 1,
    years: [2026],
    categoryGroups: [
      { id: 'food', name: 'Food', categories: ['Dining', 'Groceries'] },
      { id: 'others', name: 'Others', categories: ['Uncategorized'] },
    ],
  })
  if (rules) {
    await fileStore.writeJSON(RULES_PATH, {
      schemaVersion: 1,
      rules: [containsRule('r_01', 'starbucks', 'Dining')],
    })
  }
  return fileStore
}

const transactions = [
  { description: 'STARBUCKS #1', category: 'Uncategorized' },
  { description: 'KROGER 55', category: 'Uncategorized' },
  { description: 'STARBUCKS #2', category: 'Dining' },
]

interface Options {
  fileStore?: MemoryFileStore
  ruleSource?: RuleSource | null
  onRuleSourceClose?: () => void
}

const setup = async ({ fileStore, ruleSource = null, onRuleSourceClose = () => {} }: Options = {}) => {
  const store = fileStore ?? (await seed())
  const onInvalidate = vi.fn()
  const view = render(
    <FileStoreTestProvider store={store}>
      <TransactionImportTools
        transactions={transactions}
        ruleSource={ruleSource}
        onRuleSourceClose={onRuleSourceClose}
        onInvalidate={onInvalidate}
      />
    </FileStoreTestProvider>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled())
  return { store, onInvalidate, user: userEvent.setup(), ...view }
}

const categoriesIn = async (store: MemoryFileStore) =>
  (await store.readCSV('transactions/2026/2026-10.csv')).slice(1).map(row => row[1])

describe('TransactionImportTools', () => {
  it('disables Import and Apply until the budget has loaded', async () => {
    render(
      <FileStoreTestProvider store={new MemoryFileStore()}>
        <TransactionImportTools
          transactions={[]}
          ruleSource={null}
          onRuleSourceClose={() => {}}
          onInvalidate={() => {}}
        />
      </FileStoreTestProvider>,
    )
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply rules to uncategorized' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Rules' })).toBeEnabled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled())
  })

  it('opens the import wizard from the Import button', async () => {
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.upload(
      screen.getByTestId('import-wizard-input'),
      new File(['Date,Category,Amount,Description\n2026-11-01,Dining,-4.00,Cafe'], 'nov.csv', { type: 'text/csv' }),
    )
    expect(await screen.findByRole('heading', { name: 'Review before importing' })).toBeInTheDocument()
  })

  it('opens the rules dialog from the Rules button', async () => {
    const { user } = await setup()
    await user.click(screen.getByRole('button', { name: 'Rules' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('starbucks')).toBeInTheDocument()
  })

  it('saves a rule added in the rules dialog', async () => {
    const { user, store } = await setup()
    await user.click(screen.getByRole('button', { name: 'Rules' }))
    await user.type(await screen.findByLabelText('Description contains'), 'kroger')
    await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    await waitFor(async () => {
      const file = await store.readJSON<{ rules: unknown[] } | null>(RULES_PATH, null)
      expect(file?.rules).toHaveLength(2)
    })
  })

  it('applies rules to uncategorized transactions, then undoes it', async () => {
    const { user, store, onInvalidate } = await setup()
    await user.click(screen.getByRole('button', { name: 'Apply rules to uncategorized' }))
    expect(
      await screen.findByRole('heading', { name: 'Apply rules to 1 uncategorized transaction?' }),
    ).toBeInTheDocument()

    const changed = vi.fn()
    window.addEventListener('budget-changed', changed)
    await user.click(screen.getByRole('button', { name: 'Apply rules' }))
    expect(await screen.findByRole('heading', { name: 'Rules applied' })).toBeInTheDocument()
    expect(await categoriesIn(store)).toEqual(['Dining', 'Uncategorized', 'Dining'])
    expect(onInvalidate).toHaveBeenCalled()
    expect(changed).toHaveBeenCalled()

    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('heading', { name: 'Undone' })).toBeInTheDocument()
    expect(await categoriesIn(store)).toEqual(['Uncategorized', 'Uncategorized', 'Dining'])
    window.removeEventListener('budget-changed', changed)
  })

  it('says nothing matches when there are no rules', async () => {
    const { user } = await setup({ fileStore: await seed(false) })
    await user.click(screen.getByRole('button', { name: 'Apply rules to uncategorized' }))
    expect(await screen.findByText('No uncategorized transactions match your rules.')).toBeInTheDocument()
  })

  it('reports a write failure and leaves the files as they were', async () => {
    const fileStore = await seed()
    const { user } = await setup({ fileStore })
    await user.click(screen.getByRole('button', { name: 'Apply rules to uncategorized' }))
    await screen.findByRole('button', { name: 'Apply rules' })
    const write = fileStore.writeCSV.bind(fileStore)
    let failing = true
    fileStore.writeCSV = async (path, rows) => {
      if (failing) throw new Error('disk full')
      return write(path, rows)
    }
    await user.click(screen.getByRole('button', { name: 'Apply rules' }))
    expect(await screen.findByRole('heading', { name: 'Rules were not applied' })).toBeInTheDocument()
    failing = false
    expect(await categoriesIn(fileStore)).toEqual(['Uncategorized', 'Uncategorized', 'Dining'])
  })

  it('refuses to apply when a month changed while the dialog was open', async () => {
    const fileStore = await seed()
    const { user } = await setup({ fileStore })
    await user.click(screen.getByRole('button', { name: 'Apply rules to uncategorized' }))
    await screen.findByRole('button', { name: 'Apply rules' })
    await act(async () => {
      await fileStore.writeCSV(
        'transactions/2026/2026-10.csv',
        parseCSV(`${OCT}\n2026-10-09,Uncategorized,-1.00,Extra`),
      )
      window.dispatchEvent(new Event('budget-changed'))
    })
    await user.click(screen.getByRole('button', { name: 'Apply rules' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed while this window was open/)
  })

  describe('create rule', () => {
    const source: RuleSource = { description: 'KROGER 55', category: 'Uncategorized' }

    it('opens the create dialog for the transaction and saves only the rule', async () => {
      const { user, store } = await setup({ ruleSource: source })
      const dialog = await screen.findByRole('dialog', { name: 'Create a rule' })
      expect(within(dialog).getByLabelText('Description contains')).toHaveValue('KROGER')

      await user.selectOptions(within(dialog).getByLabelText('Category'), 'Groceries')
      await user.click(within(dialog).getByRole('button', { name: 'Create rule' }))
      expect((await screen.findAllByText('Rule saved.')).length).toBeGreaterThan(0)

      const file = await store.readJSON<{ rules: { category: string }[] } | null>(RULES_PATH, null)
      expect(file?.rules.map(rule => rule.category)).toEqual(['Dining', 'Groceries'])
      expect(await categoriesIn(store)).toEqual(['Uncategorized', 'Uncategorized', 'Dining'])
    })

    it('saves and applies the new rule only, and can undo the apply', async () => {
      const { user, store } = await setup({ ruleSource: source })
      const dialog = await screen.findByRole('dialog', { name: 'Create a rule' })
      await user.selectOptions(within(dialog).getByLabelText('Category'), 'Groceries')
      await user.click(await within(dialog).findByRole('button', { name: 'Create rule and apply to 1' }))
      expect((await screen.findAllByText('Rule saved. Recategorized 1 transaction.')).length).toBeGreaterThan(0)
      expect(await categoriesIn(store)).toEqual(['Uncategorized', 'Groceries', 'Dining'])

      await user.click(await screen.findByRole('button', { name: 'Undo' }))
      await waitFor(async () => expect(await categoriesIn(store)).toEqual(['Uncategorized', 'Uncategorized', 'Dining']))
    })

    it('does not offer Undo once the months have changed again', async () => {
      const { user, store } = await setup({ ruleSource: source })
      const dialog = await screen.findByRole('dialog', { name: 'Create a rule' })
      await user.selectOptions(within(dialog).getByLabelText('Category'), 'Groceries')
      await user.click(await within(dialog).findByRole('button', { name: 'Create rule and apply to 1' }))
      await screen.findByRole('button', { name: 'Undo' })
      await act(async () => {
        await store.writeCSV('transactions/2026/2026-10.csv', parseCSV(`${OCT}\n2026-10-09,Dining,-1.00,Extra`))
        window.dispatchEvent(new Event('budget-changed'))
        await new Promise(resolve => setTimeout(resolve, 50))
      })
      await user.click(screen.getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText(/could not be undone/)).toBeInTheDocument()
    })

    it('shows the rules-unreadable warning when the rules file is from a newer version', async () => {
      const fileStore = await seed(false)
      await fileStore.writeJSON(RULES_PATH, { schemaVersion: 99, rules: [] })
      await setup({ fileStore, ruleSource: source })
      expect(await screen.findByText(/newer version of Worth/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Create rule' })).not.toBeInTheDocument()
    })

    it('closes through the host callback', async () => {
      const onRuleSourceClose = vi.fn()
      const { user } = await setup({ ruleSource: source, onRuleSourceClose })
      await user.click(await screen.findByRole('button', { name: 'Cancel' }))
      expect(onRuleSourceClose).toHaveBeenCalled()
    })

    it('reports a rule save failure', async () => {
      const fileStore = await seed()
      const { user } = await setup({ fileStore, ruleSource: source })
      const dialog = await screen.findByRole('dialog', { name: 'Create a rule' })
      fileStore.writeJSON = async () => {
        throw new Error('disk full')
      }
      await user.selectOptions(within(dialog).getByLabelText('Category'), 'Groceries')
      await user.click(within(dialog).getByRole('button', { name: 'Create rule' }))
      expect(await screen.findByText(/could not be saved/)).toBeInTheDocument()
    })
  })

  describe('when the budget files cannot be read', () => {
    const failReads = (fileStore: MemoryFileStore) => {
      const listFiles = fileStore.listFiles.bind(fileStore)
      let failing = true
      fileStore.listFiles = async path => {
        if (failing && path === 'transactions') throw new Error('permission denied')
        return listFiles(path)
      }
      return () => {
        failing = false
      }
    }

    it('keeps Import and Apply disabled, says why, and writes nothing', async () => {
      const fileStore = await seed()
      failReads(fileStore)
      const writes = vi.spyOn(fileStore, 'writeCSV')
      const user = userEvent.setup()
      render(
        <FileStoreTestProvider store={fileStore}>
          <TransactionImportTools
            transactions={transactions}
            ruleSource={null}
            onRuleSourceClose={() => {}}
            onInvalidate={() => {}}
          />
        </FileStoreTestProvider>,
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(/could not read your budget files/)
      expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Apply rules to uncategorized' })).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'Import' }))
      expect(writes).not.toHaveBeenCalled()
      expect(await categoriesIn(fileStore)).toEqual(['Uncategorized', 'Uncategorized', 'Dining'])
    })

    it('enables Import and Apply and clears the message after a successful retry', async () => {
      const fileStore = await seed()
      const recover = failReads(fileStore)
      const user = userEvent.setup()
      render(
        <FileStoreTestProvider store={fileStore}>
          <TransactionImportTools
            transactions={transactions}
            ruleSource={null}
            onRuleSourceClose={() => {}}
            onInvalidate={() => {}}
          />
        </FileStoreTestProvider>,
      )
      await screen.findByRole('alert')
      recover()
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled())
      expect(screen.getByRole('button', { name: 'Apply rules to uncategorized' })).toBeEnabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
