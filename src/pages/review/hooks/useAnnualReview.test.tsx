import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileStoreTestProvider } from '../../../test/fileStoreTestUtils'
import { balancesFor, GROUPS, makeAccounts } from '../../../test/reviewFixtures'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import { OVERRIDES_PATH } from '../../tools/utils/savingsOverrides'
import { useAnnualReview } from './useAnnualReview'

const { mockUseData, mockUseGoals } = vi.hoisted(() => ({ mockUseData: vi.fn(), mockUseGoals: vi.fn() }))
vi.mock('../../../contexts/DataContext', () => ({ useData: () => mockUseData() }))
vi.mock('../../../contexts/GoalsContext', () => ({ useGoals: () => mockUseGoals() }))

const accounts = makeAccounts({ goalType: 'fi' })
const balances = [...balancesFor(1, { '2024-12': 400000, '2025-12': 460000 })]
const HEADER = ['Date', 'Category', 'Amount']

let store: MemoryFileStore

const wrapper = ({ children }: { children: ReactNode }) => (
  <FileStoreTestProvider store={store}>{children}</FileStoreTestProvider>
)

const seedBudget = async () => {
  await store.writeJSON('budget/categories.json', { version: 1, years: [2025], categoryGroups: GROUPS })
  for (let m = 1; m <= 12; m++) {
    const key = `2025-${String(m).padStart(2, '0')}`
    await store.writeCSV(
      `transactions/2025/${key}.csv`,
      m === 1
        ? [HEADER, ['2025-01-15', 'Paycheck', '120000'], ['2025-01-16', 'Rent', '-30000']]
        : [HEADER, [`${key}-15`, 'Groceries', '-1']],
    )
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 8))
  store = new MemoryFileStore()
  mockUseData.mockReturnValue({ accounts, balances, allMonths: [], isLoaded: true })
  mockUseGoals.mockReturnValue({ goals: [], profile: { birthday: '1990-01' } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useAnnualReview', () => {
  it('stays loading until the files have been read', async () => {
    const { result } = renderHook(() => useAnnualReview(2025), { wrapper })

    expect(result.current.status).toBe('loading')
    expect(result.current.review).toBeNull()
    await waitFor(() => expect(result.current.status).toBe('ready'))
  })

  it('stays loading while DataContext has not loaded, so empty balances are not mistaken for no data', async () => {
    mockUseData.mockReturnValue({ accounts: [], balances: [], allMonths: [], isLoaded: false })
    const { result, rerender } = renderHook(() => useAnnualReview(2025), { wrapper })

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.status).toBe('loading')
    expect(result.current.review).toBeNull()

    mockUseData.mockReturnValue({ accounts, balances, allMonths: [], isLoaded: true })
    rerender()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.review?.netWorth.change).toBe(60000)
  })

  it('builds the review for the requested year from context data and the budget files', async () => {
    await seedBudget()
    await store.writeJSON(OVERRIDES_PATH, { '2025': { netIncome: 118000, savings: 40000 } })

    const { result } = renderHook(() => useAnnualReview(2025), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    const review = result.current.review!
    expect(review.year).toBe(2025)
    expect(review.status).toBe('complete')
    expect(review.netWorth.change).toBe(60000)
    expect(review.cashflow.source).toBe('budget')
    expect(review.cashflow.income).toBe(120000)
    expect(review.notes.map(n => n.code)).toContain('mismatch')
  })

  it('lists the years that have data, newest first, and the default year', async () => {
    await seedBudget()
    const { result } = renderHook(() => useAnnualReview(2025), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(result.current.years).toEqual([2026, 2025, 2024])
    expect(result.current.defaultYear).toBe(2025)
  })

  it('returns only the year list when no year is requested', async () => {
    const { result } = renderHook(() => useAnnualReview(null), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(result.current.review).toBeNull()
    expect(result.current.defaultYear).toBe(2025)
  })

  it('lists an unreadable transaction month in a note and still builds the review', async () => {
    await seedBudget()
    await store.writeCSV('transactions/2025/2025-03.csv', [
      ['not', 'a', 'budget'],
      ['1', '2', '3'],
    ])

    const { result } = renderHook(() => useAnnualReview(2025), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(result.current.review?.cashflow.unreadableMonths).toEqual(['2025-03'])
    expect(result.current.review?.notes).toContainEqual({ code: 'unreadable', months: ['2025-03'] })
  })

  it('uses a fallback birthday when the profile has none', async () => {
    mockUseGoals.mockReturnValue({ goals: [], profile: { birthday: '' } })
    const { result } = renderHook(() => useAnnualReview(2025), { wrapper })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.review?.goals).toEqual([])
  })

  describe('read errors', () => {
    it('reports an error instead of throwing when the manual log cannot be read, then recovers on retry', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const readJSON = store.readJSON.bind(store)
      let failing = true
      vi.spyOn(store, 'readJSON').mockImplementation(async (path, fallback) => {
        if (path === OVERRIDES_PATH && failing) throw new Error('permission denied')
        return readJSON(path, fallback)
      })

      const { result } = renderHook(() => useAnnualReview(2025), { wrapper })
      await waitFor(() => expect(result.current.status).toBe('error'))
      expect(result.current.review).toBeNull()
      expect(errorSpy).toHaveBeenCalled()

      failing = false
      act(() => result.current.retry())
      await waitFor(() => expect(result.current.status).toBe('ready'))
    })
  })

  describe('reloading', () => {
    it.each(['budget-changed', 'tools-changed', 'data-changed'])('reads the files again on %s', async eventName => {
      const { result } = renderHook(() => useAnnualReview(2025), { wrapper })
      await waitFor(() => expect(result.current.review?.cashflow.source).toBe('none'))

      await store.writeJSON(OVERRIDES_PATH, { '2025': { netIncome: 90000, savings: 18000 } })
      act(() => {
        window.dispatchEvent(new Event(eventName))
      })

      await waitFor(() => expect(result.current.review?.cashflow.source).toBe('manual'))
    })

    it('reads the files again when the budget categories file changes', async () => {
      const { result } = renderHook(() => useAnnualReview(2025), { wrapper })
      await waitFor(() => expect(result.current.status).toBe('ready'))

      await store.writeJSON(OVERRIDES_PATH, { '2025': { netIncome: 90000, savings: 18000 } })
      await act(async () => {
        await store.writeJSON('budget/categories.json', { version: 1, years: [], categoryGroups: GROUPS })
      })

      await waitFor(() => expect(result.current.review?.cashflow.source).toBe('manual'))
    })

    it('ignores a slow read that was overtaken by a newer one', async () => {
      const { result } = renderHook(() => useAnnualReview(2025), { wrapper })
      await waitFor(() => expect(result.current.status).toBe('ready'))

      const readJSON = store.readJSON.bind(store)
      let releaseSlow: () => void = () => {}
      let calls = 0
      vi.spyOn(store, 'readJSON').mockImplementation(async (path, fallback) => {
        if (path !== OVERRIDES_PATH) return readJSON(path, fallback)
        calls += 1
        if (calls === 1) {
          await new Promise<void>(resolve => {
            releaseSlow = resolve
          })
          return { '2025': { netIncome: 1, savings: 1 } } as typeof fallback
        }
        return { '2025': { netIncome: 90000, savings: 18000 } } as typeof fallback
      })

      act(() => {
        window.dispatchEvent(new Event('tools-changed'))
        window.dispatchEvent(new Event('tools-changed'))
      })
      await waitFor(() => expect(result.current.review?.cashflow.income).toBe(90000))
      await act(async () => {
        releaseSlow()
        await Promise.resolve()
      })

      expect(result.current.review?.cashflow.income).toBe(90000)
    })

    it('stops listening after unmount', async () => {
      const { result, unmount } = renderHook(() => useAnnualReview(2025), { wrapper })
      await waitFor(() => expect(result.current.status).toBe('ready'))
      const readSpy = vi.spyOn(store, 'readJSON')

      unmount()
      window.dispatchEvent(new Event('budget-changed'))

      expect(readSpy).not.toHaveBeenCalled()
    })
  })
})
