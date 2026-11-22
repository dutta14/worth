import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { makeFlagContextValue } from '../test/flagTestUtils'
import { FlagContext } from '../flags/FlagContext'
import { FileStoreTestProvider } from '../test/fileStoreTestUtils'
import { useSearchIndexData } from './useSearchIndexData'

vi.mock('../contexts/GoalsContext', () => ({ useGoals: () => ({ goals: [], gwGoals: [] }) }))
vi.mock('../contexts/DataContext', () => ({ useData: () => ({ accounts: [] }) }))

const flagValue = (annualReview: boolean) => makeFlagContextValue({ 'annual-review': annualReview })

const wrapperFor =
  (annualReview: boolean) =>
  ({ children }: { children: ReactNode }) => (
    <FlagContext.Provider value={flagValue(annualReview)}>
      <FileStoreTestProvider>{children}</FileStoreTestProvider>
    </FlagContext.Provider>
  )

describe('useSearchIndexData', () => {
  it('reports the annual-review flag as on so the search entry appears', async () => {
    const { result } = renderHook(() => useSearchIndexData(true), { wrapper: wrapperFor(true) })

    await waitFor(() => expect(result.current.categoryGroups).toEqual([]))
    expect(result.current.annualReviewEnabled).toBe(true)
  })

  it('reports the annual-review flag as off by default', () => {
    const { result } = renderHook(() => useSearchIndexData(false), { wrapper: wrapperFor(false) })

    expect(result.current.annualReviewEnabled).toBe(false)
  })
})
