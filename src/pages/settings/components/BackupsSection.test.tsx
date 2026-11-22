import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BackupsSection from './BackupsSection'
import { SafetyNetContext } from '../../../contexts/SafetyNetContext'
import type { SafetyNetContextValue } from '../../../contexts/SafetyNetContext'
import { EMPTY_SAFETY_SNAPSHOT, stampFor } from '../../../utils/safetyNet'
import type { BackupEntry } from '../../../utils/safetyNet'

const entry = (path: string, time: number, extra: Partial<BackupEntry> = {}): BackupEntry => {
  const stamp = stampFor(time)
  const ext = path.slice(path.lastIndexOf('.'))
  return {
    path,
    backupPath: `_backups/${path.replace(ext, '')}/${stamp}${ext}`,
    stamp,
    unsaved: false,
    size: 4300,
    ...extra,
  }
}

const NOV_8 = Date.UTC(2026, 10, 8, 18, 34, 0)
const ENTRIES = [
  entry('balances/2026.csv', NOV_8),
  entry('accounts.json', NOV_8 - 60_000, { unsaved: true, size: 12 }),
  entry('accounts.json', NOV_8 - 86_400_000),
]

const renderSection = (overrides: Partial<SafetyNetContextValue> = {}) => {
  const value: SafetyNetContextValue = {
    enabled: true,
    snapshot: EMPTY_SAFETY_SNAPSHOT,
    reconnectDenied: false,
    retryFailed: vi.fn(async () => false),
    reconnect: vi.fn(async () => {}),
    chooseFolderAgain: vi.fn(async () => {}),
    listBackups: vi.fn(async () => ENTRIES),
    restoreBackup: vi.fn(async () => {}),
    resolveCorrupt: vi.fn(async () => null),
    resolveExternal: vi.fn(async () => {}),
    notice: '',
    ...overrides,
  }
  render(
    <SafetyNetContext.Provider value={value}>
      <BackupsSection />
    </SafetyNetContext.Provider>,
  )
  return value
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BackupsSection', () => {
  it('explains what is kept and where', async () => {
    renderSection()
    expect(screen.getByRole('heading', { name: 'Backups', level: 4 })).toBeInTheDocument()
    expect(screen.getByText(/the app keeps a copy in the _backups folder/)).toBeInTheDocument()
    expect(screen.getByText(/newest 10 copies of each file are kept/)).toBeInTheDocument()
    await screen.findByLabelText('File')
  })

  it('shows a loading message until the list arrives', async () => {
    let resolve: (entries: BackupEntry[]) => void = () => {}
    renderSection({ listBackups: () => new Promise<BackupEntry[]>(r => (resolve = r)) })
    expect(screen.getByText('Reading backups...')).toBeInTheDocument()
    resolve(ENTRIES)
    await screen.findByLabelText('File')
    expect(screen.queryByText('Reading backups...')).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no copies', async () => {
    renderSection({ listBackups: vi.fn(async () => []) })
    expect(await screen.findByText('No backups yet. Copies appear the first time a file is changed.')).toBeVisible()
    expect(screen.queryByLabelText('File')).not.toBeInTheDocument()
  })

  it('shows an alert when the _backups folder cannot be read', async () => {
    renderSection({
      listBackups: vi.fn(async () => {
        throw new Error('unreadable')
      }),
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't read the _backups folder. Check that your data folder is connected.",
    )
    expect(screen.queryByLabelText('File')).not.toBeInTheDocument()
  })

  it('offers each file that has copies, and lists the first file’s copies newest first with date and size', async () => {
    renderSection()
    const select = await screen.findByLabelText('File')
    expect(
      within(select)
        .getAllByRole('option')
        .map(option => option.textContent),
    ).toEqual(['accounts.json', 'balances/2026.csv'])
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent(/Unsaved edit, Nov \d+, 2026, .* (AM|PM)/)
    expect(rows[0]).toHaveTextContent('12 B')
    expect(rows[1]).toHaveTextContent(/^Nov \d+, 2026, .* (AM|PM)4\.2 KBRestore$/)
  })

  it('filters the list by the selected file', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.selectOptions(await screen.findByLabelText('File'), 'balances/2026.csv')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Restore balances\/2026\.csv from / })).toBeInTheDocument()
  })

  it('names the file and time on every Restore button', async () => {
    renderSection()
    await screen.findByLabelText('File')
    const buttons = screen.getAllByRole('button', { name: /^Restore accounts\.json from / })
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveAccessibleName(/\(unsaved edit\)$/)
    expect(buttons[0]).toHaveTextContent('Restore')
  })

  it('asks for confirmation and moves focus to "Restore this copy"', async () => {
    const user = userEvent.setup()
    const value = renderSection()
    await screen.findByLabelText('File')

    await user.click(screen.getAllByRole('button', { name: /^Restore accounts\.json/ })[1])

    expect(
      screen.getByText('Replace the current accounts.json with this copy? The current version is backed up first.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore this copy' })).toHaveFocus()
    expect(value.restoreBackup).not.toHaveBeenCalled()
  })

  it('returns focus to that row’s Restore button when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    const value = renderSection()
    await screen.findByLabelText('File')
    const restoreButtons = screen.getAllByRole('button', { name: /^Restore accounts\.json/ })

    await user.click(restoreButtons[1])
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('button', { name: 'Restore this copy' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Restore accounts\.json/ })[1]).toHaveFocus())
    expect(value.restoreBackup).not.toHaveBeenCalled()
  })

  it('restores the chosen copy, announces it, refreshes the list and keeps focus on the row', async () => {
    const user = userEvent.setup()
    const value = renderSection()
    await screen.findByLabelText('File')

    await user.click(screen.getAllByRole('button', { name: /^Restore accounts\.json/ })[1])
    await user.click(screen.getByRole('button', { name: 'Restore this copy' }))

    expect(value.restoreBackup).toHaveBeenCalledWith(ENTRIES[2])
    expect(await screen.findByText(/^Restored accounts\.json from Nov \d+, 2026, .*\.$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore this copy' })).not.toBeInTheDocument()
    await waitFor(() => expect(value.listBackups).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Restore accounts\.json/ })[1]).toHaveFocus())
  })

  it('moves focus to the file select if the restored row is gone after the refresh', async () => {
    const user = userEvent.setup()
    const listBackups = vi.fn().mockResolvedValueOnce(ENTRIES).mockResolvedValueOnce([ENTRIES[0]])
    renderSection({ listBackups })
    await screen.findByLabelText('File')

    await user.click(screen.getAllByRole('button', { name: /^Restore accounts\.json/ })[1])
    await user.click(screen.getByRole('button', { name: 'Restore this copy' }))

    await waitFor(() => expect(screen.getByLabelText('File')).toHaveFocus())
  })

  it('shows an alert and keeps the confirmation open when the restore fails', async () => {
    const user = userEvent.setup()
    const value = renderSection({
      restoreBackup: vi.fn(async () => {
        throw new Error('nope')
      }),
    })
    await screen.findByLabelText('File')

    await user.click(screen.getAllByRole('button', { name: /^Restore accounts\.json/ })[0])
    await user.click(screen.getByRole('button', { name: 'Restore this copy' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't restore that copy. The current file was not changed. Check that your data folder is connected, then try again.",
    )
    expect(screen.getByRole('button', { name: 'Restore this copy' })).toBeInTheDocument()
    expect(value.listBackups).toHaveBeenCalledTimes(1)
  })

  it('ignores a second click on "Restore this copy" while the restore is running', async () => {
    const user = userEvent.setup()
    let finish: () => void = () => {}
    const value = renderSection({ restoreBackup: vi.fn(() => new Promise<void>(resolve => (finish = resolve))) })
    await screen.findByLabelText('File')

    await user.click(screen.getAllByRole('button', { name: /^Restore accounts\.json/ })[0])
    const confirm = screen.getByRole('button', { name: 'Restore this copy' })
    await user.click(confirm)
    await user.click(confirm)

    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(value.restoreBackup).toHaveBeenCalledTimes(1)
    finish()
    await screen.findByText(/^Restored accounts\.json/)
  })

  it('clears an earlier message when a new restore is started', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByLabelText('File')
    await user.click(screen.getAllByRole('button', { name: /^Restore accounts\.json/ })[0])
    await user.click(screen.getByRole('button', { name: 'Restore this copy' }))
    await screen.findByText(/^Restored accounts\.json/)

    await user.click(screen.getAllByRole('button', { name: /^Restore accounts\.json/ })[1])

    expect(screen.queryByText(/^Restored accounts\.json/)).not.toBeInTheDocument()
  })

  it('closes an open confirmation when another file is selected', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByLabelText('File')
    await user.click(screen.getAllByRole('button', { name: /^Restore accounts\.json/ })[0])

    await user.selectOptions(screen.getByLabelText('File'), 'balances/2026.csv')

    expect(screen.queryByRole('button', { name: 'Restore this copy' })).not.toBeInTheDocument()
  })

  it('shows a warning, not an alert, when the last backup copy failed', async () => {
    renderSection({ snapshot: { ...EMPTY_SAFETY_SNAPSHOT, backupsHealthy: false } })
    expect(
      screen.getByText("The last backup copy couldn't be saved. Your changes were saved normally."),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await screen.findByLabelText('File')
  })

  it('shows no warning while backups are healthy', async () => {
    renderSection()
    await screen.findByLabelText('File')
    expect(screen.queryByText(/last backup copy/)).not.toBeInTheDocument()
  })

  it('does not update after unmount', async () => {
    let resolve: (entries: BackupEntry[]) => void = () => {}
    const value: SafetyNetContextValue = {
      enabled: true,
      snapshot: EMPTY_SAFETY_SNAPSHOT,
      reconnectDenied: false,
      retryFailed: vi.fn(async () => false),
      reconnect: vi.fn(async () => {}),
      chooseFolderAgain: vi.fn(async () => {}),
      listBackups: () => new Promise<BackupEntry[]>(r => (resolve = r)),
      restoreBackup: vi.fn(async () => {}),
      resolveCorrupt: vi.fn(async () => null),
      resolveExternal: vi.fn(async () => {}),
      notice: '',
    }
    const { unmount } = render(
      <SafetyNetContext.Provider value={value}>
        <BackupsSection />
      </SafetyNetContext.Provider>,
    )
    unmount()
    resolve(ENTRIES)
    await Promise.resolve()
    expect(console.error).not.toHaveBeenCalled()
  })
})
