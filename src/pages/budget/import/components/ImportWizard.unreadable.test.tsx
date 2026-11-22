import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileStoreTestProvider } from '../../../../test/fileStoreTestUtils'
import { parseCSV } from '../../../../utils/csvUtils'
import { MemoryFileStore } from '../../../../utils/memoryFileStore'
import { useBudget } from '../../hooks/useBudget'
import { useImportWizard } from '../hooks/useImportWizard'
import type { ReadableFile } from '../readFile'
import { STORE_UNREADABLE_MESSAGE } from '../messages'

const OCT = 'Date,Category,Amount,Description\n2026-10-01,Dining,-4.50,Cafe'
const NEW = 'Date,Category,Amount,Description\n2026-10-05,Dining,-9.00,Diner'

const asFile = (name: string, text: string): ReadableFile => {
  const bytes = new TextEncoder().encode(text)
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer }
}

const Host = () => {
  const budget = useBudget()
  const wizard = useImportWizard({
    store: budget.store,
    commitImport: budget.commitImport,
    undoImport: budget.undoImport,
    blocked: budget.importBlocked,
    reload: budget.reload,
  })
  return (
    <div>
      <h1>Budget</h1>
      <button onClick={() => wizard.open({ files: [asFile('new.csv', NEW)] })}>Import</button>
      {wizard.element}
    </div>
  )
}

const setup = async () => {
  const fileStore = new MemoryFileStore()
  await fileStore.writeCSV('transactions/2026/2026-10.csv', parseCSV(OCT))
  await fileStore.writeJSON('budget/categories.json', { version: 1, years: [2026], categoryGroups: [] })
  const listFiles = fileStore.listFiles.bind(fileStore)
  let failing = true
  fileStore.listFiles = async path => {
    if (failing && path === 'transactions') throw new Error('permission denied')
    return listFiles(path)
  }
  const writeCSV = vi.spyOn(fileStore, 'writeCSV')
  render(
    <FileStoreTestProvider store={fileStore}>
      <Host />
    </FileStoreTestProvider>,
  )
  return {
    fileStore,
    writeCSV,
    user: userEvent.setup(),
    recover: () => {
      failing = false
    },
  }
}

describe('Import wizard when the budget files cannot be read', () => {
  it('refuses to open, explains why, and never writes over the existing month', async () => {
    const { user, writeCSV, fileStore } = await setup()
    await user.click(screen.getByRole('button', { name: 'Import' }))

    expect(await screen.findByRole('heading', { name: 'Import is paused' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(STORE_UNREADABLE_MESSAGE)
    expect(screen.queryByRole('button', { name: /^Import \d/ })).not.toBeInTheDocument()
    expect(writeCSV).not.toHaveBeenCalled()
    expect(await fileStore.readCSV('transactions/2026/2026-10.csv')).toEqual(parseCSV(OCT))
  })

  it('works again once the files can be read', async () => {
    const { user, recover } = await setup()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByRole('heading', { name: 'Import is paused' })
    recover()
    // Opening while blocked asks the budget to read again; once that succeeds the next open goes through.
    for (let attempt = 0; attempt < 2; attempt++) {
      await user.click(screen.getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'Import' }))
      if (attempt === 0) await screen.findByRole('heading', { name: 'Import is paused' })
    }
    expect(await screen.findByRole('heading', { name: 'Review before importing' })).toBeInTheDocument()
  })
})
