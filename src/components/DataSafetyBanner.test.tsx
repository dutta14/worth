import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DataSafetyBanner from './DataSafetyBanner'
import { SafetyNetContext } from '../contexts/SafetyNetContext'
import type { SafetyNetContextValue } from '../contexts/SafetyNetContext'
import { EMPTY_SAFETY_SNAPSHOT } from '../utils/safetyNet'
import type { BackupEntry, SafetySnapshot } from '../utils/safetyNet'

const failedSnapshot = (...paths: string[]): SafetySnapshot => ({
  failed: paths.map(path => ({ path, kind: 'other' as const })),
  corrupt: [],
  stale: [],
  permissionLost: false,
  backupsHealthy: true,
})

const makeValue = (overrides: Partial<SafetyNetContextValue> = {}): SafetyNetContextValue => ({
  enabled: true,
  snapshot: EMPTY_SAFETY_SNAPSHOT,
  reconnectDenied: false,
  retryFailed: vi.fn(async () => false),
  reconnect: vi.fn(async () => {}),
  chooseFolderAgain: vi.fn(async () => {}),
  listBackups: vi.fn(async () => []),
  restoreBackup: vi.fn(async () => {}),
  resolveCorrupt: vi.fn(async () => null),
  resolveExternal: vi.fn(async () => {}),
  notice: '',
  ...overrides,
})

const Page = ({ value }: { value: SafetyNetContextValue }) => (
  <SafetyNetContext.Provider value={value}>
    <input aria-label="Balance" />
    <DataSafetyBanner />
    <main id="main-content" tabIndex={-1} />
  </SafetyNetContext.Provider>
)

const renderBanner = (value: SafetyNetContextValue) => {
  const view = render(<Page value={value} />)
  return { ...view, update: (next: SafetyNetContextValue) => view.rerender(<Page value={next} />) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DataSafetyBanner', () => {
  describe('visibility', () => {
    it('shows no banner or region when there are no issues, but keeps an empty live region mounted', () => {
      renderBanner(makeValue())
      expect(screen.queryByRole('region', { name: 'Data safety' })).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('renders nothing when the safety net is off, even with issues in the snapshot', () => {
      renderBanner(makeValue({ enabled: false, snapshot: failedSnapshot('a.json') }))
      expect(screen.queryByRole('region', { name: 'Data safety' })).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('has no way to dismiss it', () => {
      renderBanner(makeValue({ snapshot: failedSnapshot('a.json') }))
      expect(screen.queryByRole('button', { name: /dismiss|close/i })).not.toBeInTheDocument()
      expect(screen.getAllByRole('button')).toHaveLength(1)
    })
  })

  describe('write failure', () => {
    it('announces the failed file as an alert inside a named region', () => {
      renderBanner(makeValue({ snapshot: failedSnapshot('balances/2026.csv') }))
      const region = screen.getByRole('region', { name: 'Data safety' })
      const alert = within(region).getByRole('alert')
      expect(alert).toHaveTextContent("Couldn't save changes to balances/2026.csv.")
      expect(alert).toHaveTextContent(
        'Your changes are still on screen but not on disk. Check that your data folder is available, then try again.',
      )
      expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    })

    it('counts files when several failed', () => {
      renderBanner(makeValue({ snapshot: failedSnapshot('a.json', 'b.json', 'c.json') }))
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save changes to 3 files.")
    })

    it('explains a full disk', () => {
      renderBanner(
        makeValue({
          snapshot: {
            failed: [{ path: 'a.json', kind: 'disk-full' }],
            corrupt: [],
            stale: [],
            permissionLost: false,
            backupsHealthy: true,
          },
        }),
      )
      expect(screen.getByRole('alert')).toHaveTextContent('The disk looks full. Free some space, then try again.')
    })

    it('shows a busy state while retrying and ignores a second click', async () => {
      const user = userEvent.setup()
      let finish: () => void = () => {}
      const retryFailed = vi.fn(() => new Promise<boolean>(resolve => (finish = () => resolve(false))))
      renderBanner(makeValue({ snapshot: failedSnapshot('a.json'), retryFailed }))
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      const busy = screen.getByRole('button', { name: 'Trying again...' })
      expect(busy).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByRole('alert')).toHaveAttribute('aria-busy', 'true')
      await user.click(busy)
      expect(retryFailed).toHaveBeenCalledTimes(1)
      await act(async () => finish())
      expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-disabled', 'false')
      expect(screen.getByRole('alert')).not.toHaveAttribute('aria-busy')
    })

    it('says so when the retry still fails, and resets the wording after it clears', async () => {
      const user = userEvent.setup()
      const value = makeValue({ snapshot: failedSnapshot('a.json'), retryFailed: vi.fn(async () => true) })
      const { update } = renderBanner(value)
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Still couldn't save a.json. Your changes are safe on screen; leaving this tab would lose them.",
      )
      update({ ...value, snapshot: EMPTY_SAFETY_SNAPSHOT })
      update({ ...value, snapshot: failedSnapshot('a.json') })
      expect(screen.getByRole('alert')).toHaveTextContent('Your changes are still on screen but not on disk.')
    })

    it('uses the first-failure wording for a new failure after a successful retry', async () => {
      const user = userEvent.setup()
      const diskFull: SafetySnapshot = {
        failed: [{ path: 'b.json', kind: 'disk-full' }],
        corrupt: [],
        stale: [],
        permissionLost: false,
        backupsHealthy: true,
      }
      // The store clears its failures while the retry is still resolving, as in the real flow.
      const retryFailed = vi.fn(async () => {
        update({ ...value, snapshot: EMPTY_SAFETY_SNAPSHOT })
        return false
      })
      const value = makeValue({ snapshot: failedSnapshot('a.json'), retryFailed })
      const { update } = renderBanner(value)
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      update({ ...value, snapshot: diskFull })
      const alert = screen.getByRole('alert')
      expect(alert).not.toHaveTextContent("Still couldn't save")
      expect(alert).toHaveTextContent('The disk looks full. Free some space, then try again.')
    })
  })

  describe('permission loss', () => {
    const lost: SafetySnapshot = { failed: [], corrupt: [], stale: [], permissionLost: true, backupsHealthy: true }

    it('offers to reconnect the folder from a click handler', async () => {
      const user = userEvent.setup()
      const reconnect = vi.fn(async () => {})
      renderBanner(makeValue({ snapshot: lost, reconnect }))
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('Access to your data folder was lost.')
      expect(alert).toHaveTextContent('Your changes are still on screen but not saved. Reconnect to keep them.')
      await user.click(screen.getByRole('button', { name: 'Reconnect folder' }))
      expect(reconnect).toHaveBeenCalledTimes(1)
    })

    it('offers to choose the folder again, with a warning, once reconnect is denied', async () => {
      const user = userEvent.setup()
      const chooseFolderAgain = vi.fn(async () => {})
      renderBanner(makeValue({ snapshot: lost, reconnectDenied: true, chooseFolderAgain }))
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Access wasn't granted. Choosing the folder again reloads it from disk, so unsaved changes on screen may be lost.",
      )
      expect(screen.queryByRole('button', { name: 'Reconnect folder' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Choose folder again' }))
      expect(chooseFolderAgain).toHaveBeenCalledTimes(1)
    })

    it('shows the permission issue for a permission-caused write failure instead of a save error', () => {
      renderBanner(
        makeValue({
          snapshot: {
            failed: [{ path: 'a.json', kind: 'permission' }],
            corrupt: [],
            stale: [],
            permissionLost: true,
            backupsHealthy: true,
          },
        }),
      )
      expect(screen.getByRole('alert')).toHaveTextContent('Access to your data folder was lost.')
      expect(screen.queryByText(/more issue/)).not.toBeInTheDocument()
    })
  })

  describe('multiple issues', () => {
    it('shows only the highest-priority issue and counts the rest', () => {
      renderBanner(
        makeValue({
          snapshot: {
            failed: [
              { path: 'a.json', kind: 'permission' },
              { path: 'b.json', kind: 'disk-full' },
            ],
            corrupt: [],
            stale: [],
            permissionLost: true,
            backupsHealthy: true,
          },
        }),
      )
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('Access to your data folder was lost.')
      expect(alert).not.toHaveTextContent("Couldn't save changes")
      expect(alert).toHaveTextContent('1 more issue needs attention.')
      expect(screen.getAllByRole('alert')).toHaveLength(1)
    })

    it('reveals the next issue once the top one is resolved', () => {
      const both: SafetySnapshot = {
        failed: [{ path: 'b.json', kind: 'other' }],
        corrupt: [],
        stale: [],
        permissionLost: true,
        backupsHealthy: true,
      }
      const { update } = renderBanner(makeValue({ snapshot: both }))
      update(makeValue({ snapshot: failedSnapshot('b.json') }))
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save changes to b.json.")
      expect(screen.queryByText(/more issue/)).not.toBeInTheDocument()
    })
  })

  describe('when issues resolve', () => {
    it('keeps the same live region element across the whole failure and recovery cycle', () => {
      const { update } = renderBanner(makeValue())
      const status = screen.getByRole('status')
      update(makeValue({ snapshot: failedSnapshot('a.json') }))
      expect(screen.getByRole('status')).toBe(status)
      update(makeValue())
      expect(screen.getByRole('status')).toBe(status)
    })

    it('announces "All changes saved." once and clears it after a second', () => {
      vi.useFakeTimers()
      const { update } = renderBanner(makeValue({ snapshot: failedSnapshot('a.json') }))
      expect(screen.getByRole('region')).toBeInTheDocument()
      update(makeValue())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('All changes saved.')
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toBe(status)
      expect(status).toBeEmptyDOMElement()
    })

    it('moves focus to the main content when the pressed button disappears', async () => {
      const user = userEvent.setup()
      const value = makeValue({ snapshot: failedSnapshot('a.json') })
      const { update } = renderBanner(value)
      await user.tab()
      await user.tab()
      expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus()
      update(makeValue())
      expect(document.getElementById('main-content')).toHaveFocus()
    })

    it('does not take focus from a field the user is typing in', async () => {
      const user = userEvent.setup()
      const { update } = renderBanner(makeValue({ snapshot: failedSnapshot('a.json') }))
      await user.click(screen.getByRole('textbox', { name: 'Balance' }))
      update(makeValue())
      expect(screen.getByRole('textbox', { name: 'Balance' })).toHaveFocus()
      expect(screen.getByRole('status')).toHaveTextContent('All changes saved.')
    })

    it('does not announce anything for a banner that never had an issue', () => {
      const { update } = renderBanner(makeValue())
      update(makeValue())
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('clears a pending saved message when a new issue arrives', () => {
      vi.useFakeTimers()
      const { update } = renderBanner(makeValue({ snapshot: failedSnapshot('a.json') }))
      update(makeValue())
      update(makeValue({ snapshot: failedSnapshot('b.json') }))
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      expect(screen.getByRole('alert')).toHaveTextContent('b.json')
    })
  })

  describe('corrupt file', () => {
    const corruptSnapshot = (
      ...files: { path: string; copyPath: string | null; hasBackup: boolean }[]
    ): SafetySnapshot => ({ ...EMPTY_SAFETY_SNAPSHOT, corrupt: files })

    const withCopy = { path: 'accounts.json', copyPath: 'accounts.json.corrupt-20261108T183437123Z', hasBackup: true }

    const backup: BackupEntry = {
      path: 'accounts.json',
      backupPath: '_backups/accounts/20261101T120000000Z.json',
      stamp: '20261101T120000000Z',
      unsaved: false,
      size: 10,
    }

    it('names the file and the saved copy, and explains that saving is paused', () => {
      renderBanner(makeValue({ snapshot: corruptSnapshot(withCopy) }))
      const alert = within(screen.getByRole('region', { name: 'Data safety' })).getByRole('alert')
      expect(alert).toHaveTextContent("Couldn't read accounts.json.")
      expect(alert).toHaveTextContent(
        "The file isn't valid JSON, so the app left it untouched and saved a copy as accounts.json.corrupt-20261108T183437123Z. Changes to it won't be saved until you choose how to continue.",
      )
    })

    it('shows only the copy name for a file in a folder', () => {
      renderBanner(
        makeValue({
          snapshot: corruptSnapshot({
            path: 'budget/categories.json',
            copyPath: 'budget/categories.json.corrupt-20261108T183437123Z',
            hasBackup: false,
          }),
        }),
      )
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent("Couldn't read budget/categories.json.")
      expect(alert).toHaveTextContent('saved a copy as categories.json.corrupt-20261108T183437123Z.')
    })

    it('says no copy could be saved when there is none', () => {
      renderBanner(makeValue({ snapshot: corruptSnapshot({ ...withCopy, copyPath: null }) }))
      expect(screen.getByRole('alert')).toHaveTextContent(
        "The file isn't valid JSON and a copy couldn't be saved, so the app left it untouched. Changes to it won't be saved until you choose how to continue.",
      )
    })

    it('offers both choices, Restore first, when a valid backup exists', () => {
      renderBanner(makeValue({ snapshot: corruptSnapshot(withCopy) }))
      const buttons = within(screen.getByRole('alert')).getAllByRole('button')
      expect(buttons.map(button => button.textContent)).toEqual(['Restore latest backup', 'Start fresh'])
    })

    it('hides Restore when no valid backup exists', () => {
      renderBanner(makeValue({ snapshot: corruptSnapshot({ ...withCopy, hasBackup: false }) }))
      expect(screen.queryByRole('button', { name: 'Restore latest backup' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start fresh' })).toBeInTheDocument()
    })

    it('restores the latest backup for that file and announces the date', async () => {
      const user = userEvent.setup()
      const resolveCorrupt = vi.fn(async () => backup)
      renderBanner(makeValue({ snapshot: corruptSnapshot(withCopy), resolveCorrupt }))

      await user.click(screen.getByRole('button', { name: 'Restore latest backup' }))

      expect(resolveCorrupt).toHaveBeenCalledWith('accounts.json', 'restore-latest')
      expect(screen.getByRole('status')).toHaveTextContent('accounts.json restored from the backup of Nov 1, 2026')
    })

    it('starts fresh for that file and says the unreadable copy is still there', async () => {
      const user = userEvent.setup()
      const resolveCorrupt = vi.fn(async () => null)
      renderBanner(makeValue({ snapshot: corruptSnapshot(withCopy), resolveCorrupt }))

      await user.click(screen.getByRole('button', { name: 'Start fresh' }))

      expect(resolveCorrupt).toHaveBeenCalledWith('accounts.json', 'start-fresh')
      expect(screen.getByRole('status')).toHaveTextContent(
        'accounts.json replaced. The unreadable copy is still in your folder.',
      )
    })

    it('shows the specific message, not "All changes saved.", once the store clears the issue', async () => {
      const user = userEvent.setup()
      let finish: (entry: BackupEntry | null) => void = () => {}
      const resolveCorrupt = vi.fn(() => new Promise<BackupEntry | null>(resolve => (finish = resolve)))
      const value = makeValue({ snapshot: corruptSnapshot(withCopy), resolveCorrupt })
      const { update } = renderBanner(value)

      await user.click(screen.getByRole('button', { name: 'Start fresh' }))
      // The store clears the issue first, then the promise settles.
      update({ ...value, snapshot: EMPTY_SAFETY_SNAPSHOT })
      await act(async () => finish(null))

      expect(screen.getByRole('status')).toHaveTextContent('accounts.json replaced.')
      expect(screen.getByRole('status')).not.toHaveTextContent('All changes saved.')
    })

    it('moves focus to the main content when the buttons disappear', async () => {
      const user = userEvent.setup()
      const value = makeValue({ snapshot: corruptSnapshot(withCopy) })
      const { update } = renderBanner(value)
      await user.tab()
      await user.tab()
      expect(screen.getByRole('button', { name: 'Restore latest backup' })).toHaveFocus()
      update({ ...value, snapshot: EMPTY_SAFETY_SNAPSHOT })
      expect(document.getElementById('main-content')).toHaveFocus()
    })

    it('disables both buttons while resolving and ignores a second click', async () => {
      const user = userEvent.setup()
      let finish: (entry: BackupEntry | null) => void = () => {}
      const resolveCorrupt = vi.fn(() => new Promise<BackupEntry | null>(resolve => (finish = resolve)))
      renderBanner(makeValue({ snapshot: corruptSnapshot(withCopy), resolveCorrupt }))

      await user.click(screen.getByRole('button', { name: 'Start fresh' }))
      await user.click(screen.getByRole('button', { name: 'Start fresh' }))
      await user.click(screen.getByRole('button', { name: 'Restore latest backup' }))

      expect(resolveCorrupt).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('alert')).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByRole('button', { name: 'Start fresh' })).toHaveAttribute('aria-disabled', 'true')
      await act(async () => finish(null))
      expect(screen.getByRole('alert')).not.toHaveAttribute('aria-busy')
    })

    it('says the file was not changed when the resolution fails, and allows another try', async () => {
      const user = userEvent.setup()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const resolveCorrupt = vi
        .fn<(path: string, action: string) => Promise<BackupEntry | null>>()
        .mockRejectedValueOnce(new Error('disk gone'))
        .mockResolvedValueOnce(null)
      renderBanner(makeValue({ snapshot: corruptSnapshot(withCopy), resolveCorrupt }))

      await user.click(screen.getByRole('button', { name: 'Start fresh' }))

      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(
        "Couldn't finish that. The file was not changed. Check that your data folder is connected, then try again.",
      )
      expect(within(alert).getAllByRole('button')).toHaveLength(2)

      await user.click(screen.getByRole('button', { name: 'Start fresh' }))
      expect(resolveCorrupt).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('alert')).not.toHaveTextContent("Couldn't finish that.")
    })

    it('clears the failure message when a different file becomes the top issue', async () => {
      const user = userEvent.setup()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const resolveCorrupt = vi.fn(async () => {
        throw new Error('disk gone')
      })
      const value = makeValue({ snapshot: corruptSnapshot(withCopy), resolveCorrupt })
      const { update } = renderBanner(value)
      await user.click(screen.getByRole('button', { name: 'Start fresh' }))
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't finish that.")

      update({
        ...value,
        snapshot: corruptSnapshot({ path: 'profile.json', copyPath: 'profile.json.corrupt-x', hasBackup: false }),
      })

      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't read profile.json.")
      expect(screen.getByRole('alert')).not.toHaveTextContent("Couldn't finish that.")
    })

    it('ranks below permission and save failures, and counts the rest', () => {
      renderBanner(
        makeValue({
          snapshot: {
            failed: [{ path: 'a.json', kind: 'other' }],
            corrupt: [withCopy, { path: 'profile.json', copyPath: null, hasBackup: false }],
            stale: [],
            permissionLost: false,
            backupsHealthy: true,
          },
        }),
      )
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent("Couldn't save changes to a.json.")
      expect(alert).toHaveTextContent('2 more issues need attention.')
    })

    it('shows one corrupt file at a time and reveals the next after resolving', async () => {
      const user = userEvent.setup()
      const other = { path: 'profile.json', copyPath: 'profile.json.corrupt-x', hasBackup: false }
      const resolveCorrupt = vi.fn(async () => null)
      const value = makeValue({ snapshot: corruptSnapshot(withCopy, other), resolveCorrupt })
      const { update } = renderBanner(value)
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't read accounts.json.")
      expect(screen.getByRole('alert')).toHaveTextContent('1 more issue needs attention.')

      await user.click(screen.getByRole('button', { name: 'Start fresh' }))
      update({ ...value, snapshot: corruptSnapshot(other) })

      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't read profile.json.")
      expect(screen.getByRole('status')).toHaveTextContent('accounts.json replaced.')
    })

    it('shows nothing for a corrupt file when the safety net is off', () => {
      renderBanner(makeValue({ enabled: false, snapshot: corruptSnapshot(withCopy) }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('external change', () => {
    const staleSnapshot = (...files: { path: string; deleted?: boolean }[]): SafetySnapshot => ({
      ...EMPTY_SAFETY_SNAPSHOT,
      stale: files.map(({ path, deleted = false }) => ({ path, deleted })),
    })
    const region = () => screen.getByRole('region', { name: 'Data safety' })
    const banner = () =>
      within(region())
        .getByText(/on disk\.$/)
        .closest('section') as HTMLElement

    it('names the file and explains that saving is paused, as a polite status rather than an alert', () => {
      renderBanner(makeValue({ snapshot: staleSnapshot({ path: 'profile.json' }) }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(banner()).toHaveAttribute('role', 'status')
      expect(banner()).toHaveTextContent('profile.json changed on disk.')
      expect(banner()).toHaveTextContent(
        'It was changed outside this tab, maybe on another computer or by a sync tool. Saving to it is paused so nothing gets overwritten.',
      )
    })

    it('uses the plural wording for several files', () => {
      renderBanner(makeValue({ snapshot: staleSnapshot({ path: 'a.json' }, { path: 'b.csv' }) }))
      expect(banner()).toHaveTextContent('Files changed on disk.')
      expect(banner()).toHaveTextContent('They were changed outside this tab')
      expect(banner()).toHaveTextContent('Saving to them is paused')
    })

    it('uses the deleted wording for a file that is gone', () => {
      renderBanner(makeValue({ snapshot: staleSnapshot({ path: 'profile.json', deleted: true }) }))
      expect(banner()).toHaveTextContent(
        "profile.json was deleted outside this tab. Saving to it is paused. Reload to see what's on disk, or keep your version to create it again.",
      )
    })

    it('offers Reload and Keep my version, and nothing to dismiss it', () => {
      renderBanner(makeValue({ snapshot: staleSnapshot({ path: 'profile.json' }) }))
      expect(
        within(banner())
          .getAllByRole('button')
          .map(button => button.textContent),
      ).toEqual(['Reload', 'Keep my version'])
    })

    it.each([
      ['Reload', 'reload'],
      ['Keep my version', 'keep'],
    ])('runs %s for every changed file', async (label, action) => {
      const user = userEvent.setup()
      const resolveExternal = vi.fn(async () => {})
      renderBanner(makeValue({ snapshot: staleSnapshot({ path: 'a.json' }, { path: 'b.json' }), resolveExternal }))
      await user.click(screen.getByRole('button', { name: label }))
      expect(resolveExternal).toHaveBeenCalledWith(action)
    })

    it('ranks below permission, save failures and unreadable files', () => {
      renderBanner(
        makeValue({
          snapshot: {
            ...failedSnapshot('a.json'),
            corrupt: [{ path: 'accounts.json', copyPath: null, hasBackup: false }],
            stale: [{ path: 'profile.json', deleted: false }],
          },
        }),
      )
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save changes to a.json.")
      expect(screen.getByRole('alert')).toHaveTextContent('2 more issues need attention.')
    })

    it('shows a "more" line when an unreadable file is also waiting', () => {
      renderBanner(
        makeValue({
          snapshot: {
            ...staleSnapshot({ path: 'profile.json' }),
            corrupt: [{ path: 'accounts.json', copyPath: null, hasBackup: false }],
          },
        }),
      )
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't read accounts.json.")
      expect(screen.getByRole('alert')).toHaveTextContent('1 more issue needs attention.')
    })

    it('shows a busy state and ignores a second click while resolving', async () => {
      const user = userEvent.setup()
      let finish: () => void = () => {}
      const resolveExternal = vi.fn(() => new Promise<void>(resolve => (finish = resolve)))
      renderBanner(makeValue({ snapshot: staleSnapshot({ path: 'profile.json' }), resolveExternal }))
      await user.click(screen.getByRole('button', { name: 'Reload' }))
      await user.click(screen.getByRole('button', { name: 'Keep my version' }))
      expect(resolveExternal).toHaveBeenCalledTimes(1)
      expect(banner()).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByRole('button', { name: 'Reload' })).toHaveAttribute('aria-disabled', 'true')
      await act(async () => finish())
      expect(banner()).not.toHaveAttribute('aria-busy')
    })

    it('says nothing was changed when the resolution fails, and allows another try', async () => {
      const user = userEvent.setup()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const resolveExternal = vi
        .fn<(action: string) => Promise<void>>()
        .mockRejectedValueOnce(new Error('disk gone'))
        .mockResolvedValueOnce(undefined)
      renderBanner(makeValue({ snapshot: staleSnapshot({ path: 'profile.json' }), resolveExternal }))
      await user.click(screen.getByRole('button', { name: 'Keep my version' }))
      expect(region()).toHaveTextContent("Couldn't finish that. The file was not changed.")
      await user.click(screen.getByRole('button', { name: 'Keep my version' }))
      expect(resolveExternal).toHaveBeenCalledTimes(2)
      expect(region()).not.toHaveTextContent("Couldn't finish that.")
    })

    it('announces the notice from the provider, and moves focus to the page when the banner goes', async () => {
      const user = userEvent.setup()
      const value = makeValue({ snapshot: staleSnapshot({ path: 'profile.json' }) })
      const { update } = renderBanner(value)
      await user.tab()
      await user.tab()
      expect(screen.getByRole('button', { name: 'Reload' })).toHaveFocus()
      update({ ...value, snapshot: EMPTY_SAFETY_SNAPSHOT })
      expect(document.getElementById('main-content')).toHaveFocus()
      update({
        ...value,
        snapshot: EMPTY_SAFETY_SNAPSHOT,
        notice: 'Saved your version. The previous version is in _backups.',
      })
      expect(screen.getByRole('status')).toHaveTextContent('Saved your version. The previous version is in _backups.')
    })

    it('announces a notice that was already set when the banner mounts after a remount', () => {
      renderBanner(makeValue({ notice: 'Reloaded from disk. Any unsaved edits were kept in _backups.' }))
      expect(screen.getByRole('status')).toHaveTextContent(
        'Reloaded from disk. Any unsaved edits were kept in _backups.',
      )
    })

    it('resets the failure message when the set of changed files changes', async () => {
      const user = userEvent.setup()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const resolveExternal = vi.fn(async () => {
        throw new Error('disk gone')
      })
      const value = makeValue({ snapshot: staleSnapshot({ path: 'a.json' }), resolveExternal })
      const { update } = renderBanner(value)
      await user.click(screen.getByRole('button', { name: 'Reload' }))
      expect(region()).toHaveTextContent("Couldn't finish that.")
      update({ ...value, snapshot: staleSnapshot({ path: 'a.json' }, { path: 'b.json' }) })
      expect(region()).not.toHaveTextContent("Couldn't finish that.")
    })

    it('shows nothing when the safety net is off', () => {
      renderBanner(makeValue({ enabled: false, snapshot: staleSnapshot({ path: 'a.json' }) }))
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    })
  })
})
