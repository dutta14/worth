import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { FC, ReactNode } from 'react'
import { FileStoreTestProvider } from '../../../test/fileStoreTestUtils'
import { planFromTexts } from '../../../test/importHelpers'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import { useBudget } from './useBudget'

const TEXT = 'Date,Category,Amount,Description\n2026-10-01,Salary,3200.00,Payroll\n2026-10-02,Dining,-6.75,Starbucks'

describe('useBudget commitImport and undoImport', () => {
  const setup = () => {
    const fileStore = new MemoryFileStore()
    const wrapper: FC<{ children: ReactNode }> = ({ children }) => (
      <FileStoreTestProvider store={fileStore}>{children}</FileStoreTestProvider>
    )
    return { fileStore, ...renderHook(() => useBudget(), { wrapper }) }
  }

  it('writes through the file store, updates the store, and can undo', async () => {
    const { fileStore, result } = setup()
    await waitFor(() => expect(result.current.store.categoryGroups?.length).toBeGreaterThan(0))

    const plan = planFromTexts([{ name: 'a.csv', text: TEXT }], { groups: result.current.store.categoryGroups ?? [] })
    let commit: Awaited<ReturnType<typeof result.current.commitImport>> | undefined
    await act(async () => {
      commit = await result.current.commitImport(plan)
    })
    if (!commit?.ok) throw new Error('expected the import to succeed')
    const { undo } = commit
    expect(result.current.store.csvs['2026-10'].csv).toContain('Starbucks')
    expect(await fileStore.listFiles('transactions/2026')).toEqual(['2026-10.csv'])

    await act(async () => {
      expect(await result.current.undoImport(undo)).toEqual({ ok: true })
    })
    expect(result.current.store.csvs['2026-10']).toBeUndefined()
    expect(await fileStore.listFiles('transactions/2026')).toEqual([])
  })

  it('keeps the store as it was when the import fails', async () => {
    const { fileStore, result } = setup()
    await waitFor(() => expect(result.current.store.categoryGroups?.length).toBeGreaterThan(0))
    fileStore.writeCSV = async () => {
      throw new Error('disk full')
    }
    const plan = planFromTexts([{ name: 'a.csv', text: TEXT }])
    await act(async () => {
      const outcome = await result.current.commitImport(plan)
      expect(outcome.ok).toBe(false)
    })
    expect(result.current.store.csvs).toEqual({})
  })
})
