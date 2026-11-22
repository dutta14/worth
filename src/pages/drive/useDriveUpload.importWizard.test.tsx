import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FlagContext } from '../../flags/FlagContext'
import { FileStoreTestProvider } from '../../test/fileStoreTestUtils'
import { makeFlagContextValue } from '../../test/flagTestUtils'
import { MemoryFileStore } from '../../utils/memoryFileStore'
import { useDriveUpload } from './useDriveUpload'

const CSV = 'Date,Category,Amount,Description\n2026-11-01,Dining,-4.00,Cafe'

const Harness = ({ refreshTree, onViewTransactions }: { refreshTree: () => void; onViewTransactions?: () => void }) => {
  const upload = useDriveUpload(refreshTree, { onViewTransactions })
  return (
    <>
      <input data-testid="picker" type="file" multiple onChange={upload.handleFileInputChange} />
      {upload.importWizardOn && upload.wizardElement}
      {upload.csvPreview && <div data-testid="legacy-preview" />}
    </>
  )
}

const setup = (importWizard: boolean, store = new MemoryFileStore()) => {
  const refreshTree = vi.fn()
  render(
    <FlagContext.Provider value={makeFlagContextValue({ 'import-wizard': importWizard })}>
      <FileStoreTestProvider store={store}>
        <MemoryRouter>
          <Harness refreshTree={refreshTree} />
        </MemoryRouter>
      </FileStoreTestProvider>
    </FlagContext.Provider>,
  )
  return { refreshTree, store, user: userEvent.setup() }
}

const upload = (user: ReturnType<typeof userEvent.setup>) =>
  user.upload(screen.getByTestId('picker'), new File([CSV], 'whatever.csv', { type: 'text/csv' }))

describe('useDriveUpload with the import-wizard flag', () => {
  it('opens the wizard for chosen files and skips the filename-month preview', async () => {
    const { user } = setup(true)
    await upload(user)
    expect(await screen.findByRole('heading', { name: 'Review before importing' })).toBeInTheDocument()
    expect(screen.queryByTestId('legacy-preview')).not.toBeInTheDocument()
  })

  it('refreshes the Drive tree after the wizard imports, using the dates in the rows', async () => {
    const { user, refreshTree, store } = setup(true)
    await upload(user)
    await user.click(await screen.findByRole('button', { name: /^Import / }))
    await waitFor(() => expect(refreshTree).toHaveBeenCalled())
    expect(await store.listFiles('transactions/2026')).toEqual(['2026-11.csv'])
  })

  it('keeps the legacy filename flow when the flag is off', async () => {
    const { user } = setup(false)
    await upload(user)
    expect(screen.queryByRole('heading', { name: 'Review before importing' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('picker')).toBeInTheDocument()
  })

  it('pauses the import instead of writing when the budget files cannot be read', async () => {
    const store = new MemoryFileStore()
    store.listFiles = async () => {
      throw new Error('permission denied')
    }
    const writeCSV = vi.spyOn(store, 'writeCSV')
    const { user } = setup(true, store)
    await upload(user)
    expect(await screen.findByRole('heading', { name: 'Import is paused' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review before importing' })).not.toBeInTheDocument()
    expect(writeCSV).not.toHaveBeenCalled()
  })
})
