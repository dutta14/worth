import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { FC, ReactNode } from 'react'
import { FileStoreTestProvider } from '../../../test/fileStoreTestUtils'
import { planFromTexts } from '../../../test/importHelpers'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import { parseCSV } from '../../../utils/csvUtils'
import { useBudget } from './useBudget'

const TEXT = 'Date,Category,Amount,Description\n2026-10-01,Salary,3200.00,Payroll\n2026-10-02,Dining,-6.75,Starbucks'

const setup = () => {
  const fileStore = new MemoryFileStore()
  const wrapper: FC<{ children: ReactNode }> = ({ children }) => (
    <FileStoreTestProvider store={fileStore}>{children}</FileStoreTestProvider>
  )
  return { fileStore, ...renderHook(() => useBudget(), { wrapper }) }
}

describe('useBudget commitImport and undoImport', () => {
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

describe('useBudget commitImport when the budget files cannot be read', () => {
  it('reports importBlocked, refuses to commit and writes nothing', async () => {
    const { fileStore, result } = setup()
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await fileStore.writeCSV('transactions/2026/2026-10.csv', parseCSV(TEXT))
    const listFiles = fileStore.listFiles.bind(fileStore)
    fileStore.listFiles = async path => {
      if (path === 'transactions') throw new Error('permission denied')
      return listFiles(path)
    }
    await act(async () => {
      await fileStore.writeJSON('budget/categories.json', { version: 1, years: [2026], categoryGroups: [] })
    })
    await waitFor(() => expect(result.current.importBlocked).toBe(true))

    const writeCSV = vi.spyOn(fileStore, 'writeCSV')
    const plan = planFromTexts([{ name: 'a.csv', text: TEXT }])
    let outcome: Awaited<ReturnType<typeof result.current.commitImport>> | undefined
    await act(async () => {
      outcome = await result.current.commitImport(plan)
    })
    expect(outcome).toMatchObject({ ok: false, reason: 'unreadable' })
    expect(writeCSV).not.toHaveBeenCalled()
  })

  it('leaves loaded false when the first read fails, so no year is created over unreadable files', async () => {
    const fileStore = new MemoryFileStore()
    fileStore.listFiles = async () => {
      throw new Error('permission denied')
    }
    const writeCSV = vi.spyOn(fileStore, 'writeCSV')
    const wrapper: FC<{ children: ReactNode }> = ({ children }) => (
      <FileStoreTestProvider store={fileStore}>{children}</FileStoreTestProvider>
    )
    const { result } = renderHook(() => useBudget(), { wrapper })
    await waitFor(() => expect(result.current.importBlocked).toBe(true))
    expect(result.current.loaded).toBe(false)
    expect(writeCSV).not.toHaveBeenCalled()
  })
})
