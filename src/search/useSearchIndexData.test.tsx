import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FileStoreTestProvider } from '../test/fileStoreTestUtils'
import { MemoryFileStore } from '../utils/memoryFileStore'
import { useSearchIndexData } from './useSearchIndexData'

vi.mock('../contexts/GoalsContext', () => ({ useGoals: () => ({ goals: [], gwGoals: [] }) }))
vi.mock('../contexts/DataContext', () => ({ useData: () => ({ accounts: [] }) }))

const groups = [{ id: 'food', name: 'Food', categories: ['Groceries'] }]

const makeWrapper = (store: MemoryFileStore) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <FileStoreTestProvider store={store}>{children}</FileStoreTestProvider>
  }

describe('useSearchIndexData', () => {
  it('loads the file-backed slices while enabled', async () => {
    const store = new MemoryFileStore()
    await store.writeJSON('budget/categories.json', { categoryGroups: groups })
    const { result } = renderHook(() => useSearchIndexData(true), { wrapper: makeWrapper(store) })

    await waitFor(() => expect(result.current.categoryGroups).toEqual(groups))
  })

  it('reads nothing from the data folder while disabled', async () => {
    const store = new MemoryFileStore()
    await store.writeJSON('budget/categories.json', { categoryGroups: groups })
    const { result } = renderHook(() => useSearchIndexData(false), { wrapper: makeWrapper(store) })

    expect(result.current.categoryGroups).toEqual([])
  })
})
