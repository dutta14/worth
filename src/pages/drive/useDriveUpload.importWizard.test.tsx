import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FileStoreTestProvider } from '../../test/fileStoreTestUtils'
import { MemoryFileStore } from '../../utils/memoryFileStore'
import { useDriveUpload } from './useDriveUpload'

const CSV = 'Date,Category,Amount,Description\n2026-11-01,Dining,-4.00,Cafe'

const Harness = ({ refreshTree, onViewTransactions }: { refreshTree: () => void; onViewTransactions?: () => void }) => {
  const upload = useDriveUpload(refreshTree, { onViewTransactions })
  return (
    <>
      <input data-testid="picker" type="file" multiple onChange={upload.handleFileInputChange} />
      {upload.wizardElement}
    </>
  )
}

const setup = (store = new MemoryFileStore()) => {
  const refreshTree = vi.fn()
  render(
    <FileStoreTestProvider store={store}>
      <MemoryRouter>
        <Harness refreshTree={refreshTree} />
      </MemoryRouter>
    </FileStoreTestProvider>,
  )
  return { refreshTree, store, user: userEvent.setup() }
}

const upload = (user: ReturnType<typeof userEvent.setup>) =>
  user.upload(screen.getByTestId('picker'), new File([CSV], 'whatever.csv', { type: 'text/csv' }))

describe('useDriveUpload with the import wizard', () => {
  it('opens the wizard for chosen files whatever their names are', async () => {
    const { user } = setup()
    await upload(user)
    expect(await screen.findByRole('heading', { name: 'Review before importing' })).toBeInTheDocument()
  })

  it('refreshes the Drive tree after the wizard imports, using the dates in the rows', async () => {
    const { user, refreshTree, store } = setup()
    await upload(user)
    await user.click(await screen.findByRole('button', { name: /^Import / }))
    await waitFor(() => expect(refreshTree).toHaveBeenCalled())
    expect(await store.listFiles('transactions/2026')).toEqual(['2026-11.csv'])
  })

  it('pauses the import instead of writing when the budget files cannot be read', async () => {
    const store = new MemoryFileStore()
    store.listFiles = async () => {
      throw new Error('permission denied')
    }
    const writeCSV = vi.spyOn(store, 'writeCSV')
    const { user } = setup(store)
    await upload(user)
    expect(await screen.findByRole('heading', { name: 'Import is paused' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review before importing' })).not.toBeInTheDocument()
    expect(writeCSV).not.toHaveBeenCalled()
  })
})
