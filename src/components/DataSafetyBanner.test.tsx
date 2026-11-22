import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DataSafetyBanner from './DataSafetyBanner'
import { SafetyNetContext } from '../contexts/SafetyNetContext'
import type { SafetyNetContextValue } from '../contexts/SafetyNetContext'
import { EMPTY_SAFETY_SNAPSHOT } from '../utils/safetyNet'
import type { SafetySnapshot } from '../utils/safetyNet'

const failedSnapshot = (...paths: string[]): SafetySnapshot => ({
  failed: paths.map(path => ({ path, kind: 'other' as const })),
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
          snapshot: { failed: [{ path: 'a.json', kind: 'disk-full' }], permissionLost: false, backupsHealthy: true },
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
    const lost: SafetySnapshot = { failed: [], permissionLost: true, backupsHealthy: true }

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
          snapshot: { failed: [{ path: 'a.json', kind: 'permission' }], permissionLost: true, backupsHealthy: true },
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
})
