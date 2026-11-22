import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { FC, ReactNode } from 'react'
import { containsRule } from '../../../test/importHelpers'
import { FileStoreTestProvider } from '../../../test/fileStoreTestUtils'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import { loadRules, RULES_PATH } from '../import/importStorage'
import { useBudget } from './useBudget'

const rules = [containsRule('r_01', 'STARBUCKS', 'Dining'), containsRule('r_02', 'SHELL', 'Gas')]

async function setup(rulesContent: unknown = { schemaVersion: 1, rules }) {
  const fileStore = new MemoryFileStore()
  await fileStore.writeJSON('budget/categories.json', {
    version: 1,
    years: [],
    categoryGroups: [{ id: 'food', name: 'Food', categories: ['Dining', 'Cafes', 'Gas'] }],
  })
  await fileStore.writeJSON(RULES_PATH, rulesContent)
  const wrapper: FC<{ children: ReactNode }> = ({ children }) => (
    <FileStoreTestProvider store={fileStore}>{children}</FileStoreTestProvider>
  )
  const view = renderHook(() => useBudget(), { wrapper })
  await waitFor(() => expect(view.result.current.store.categoryGroups?.some(g => g.id === 'food')).toBe(true))
  return { fileStore, ...view }
}

const categories = async (fileStore: MemoryFileStore) => {
  const loaded = await loadRules(fileStore)
  return loaded.state === 'ready' ? loaded.file.rules.map(rule => rule.category) : loaded.state
}

describe('useBudget mergeCategories and import rules', () => {
  it('points rules at the merge target', async () => {
    const { fileStore, result } = await setup()
    act(() => result.current.mergeCategories(['Dining', 'Cafes'], 'Food stuff'))
    await waitFor(async () => expect(await categories(fileStore)).toEqual(['Food stuff', 'Gas']))
  })

  it('leaves an unreadable rules file as it is and logs the problem', async () => {
    const newer = { schemaVersion: 3, rules: [] }
    const { fileStore, result } = await setup(newer)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => result.current.mergeCategories(['Dining'], 'Cafes'))
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('unreadable')))
    expect(await fileStore.readJSON(RULES_PATH, null)).toEqual(newer)
    error.mockRestore()
  })
})
