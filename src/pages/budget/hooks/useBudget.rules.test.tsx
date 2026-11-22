import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { FC, ReactNode } from 'react'
import { FlagContext } from '../../../flags/FlagContext'
import { containsRule } from '../../../test/importHelpers'
import { FileStoreTestProvider } from '../../../test/fileStoreTestUtils'
import { makeFlagContextValue } from '../../../test/flagTestUtils'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import { loadRules, RULES_PATH } from '../import/importStorage'
import { useBudget } from './useBudget'

const rules = [containsRule('r_01', 'STARBUCKS', 'Dining'), containsRule('r_02', 'SHELL', 'Gas')]

async function setup(flagOn: boolean, rulesContent: unknown = { schemaVersion: 1, rules }) {
  const fileStore = new MemoryFileStore()
  await fileStore.writeJSON('budget/categories.json', {
    version: 1,
    years: [],
    categoryGroups: [{ id: 'food', name: 'Food', categories: ['Dining', 'Cafes', 'Gas'] }],
  })
  await fileStore.writeJSON(RULES_PATH, rulesContent)
  const wrapper: FC<{ children: ReactNode }> = ({ children }) => (
    <FlagContext.Provider value={makeFlagContextValue({ 'import-wizard': flagOn })}>
      <FileStoreTestProvider store={fileStore}>{children}</FileStoreTestProvider>
    </FlagContext.Provider>
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
  it('points rules at the merge target when the import wizard is on', async () => {
    const { fileStore, result } = await setup(true)
    act(() => result.current.mergeCategories(['Dining', 'Cafes'], 'Food stuff'))
    await waitFor(async () => expect(await categories(fileStore)).toEqual(['Food stuff', 'Gas']))
  })

  it('does not touch the rules file when the import wizard is off', async () => {
    const { fileStore, result } = await setup(false)
    const write = vi.spyOn(fileStore, 'writeJSON')
    act(() => result.current.mergeCategories(['Dining'], 'Cafes'))
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    expect(write.mock.calls.map(call => call[0])).not.toContain(RULES_PATH)
    expect(await categories(fileStore)).toEqual(['Dining', 'Gas'])
  })

  it('leaves an unreadable rules file as it is and logs the problem', async () => {
    const newer = { schemaVersion: 3, rules: [] }
    const { fileStore, result } = await setup(true, newer)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => result.current.mergeCategories(['Dining'], 'Cafes'))
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('unreadable')))
    expect(await fileStore.readJSON(RULES_PATH, null)).toEqual(newer)
    error.mockRestore()
  })
})
