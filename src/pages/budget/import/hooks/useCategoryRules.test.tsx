import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { FC, ReactNode } from 'react'
import { FileStoreTestProvider } from '../../../../test/fileStoreTestUtils'
import { containsRule } from '../../../../test/importHelpers'
import { MemoryFileStore } from '../../../../utils/memoryFileStore'
import { RULES_PATH } from '../importStorage'
import { useCategoryRules } from './useCategoryRules'

const wrapperFor =
  (store: MemoryFileStore): FC<{ children: ReactNode }> =>
  ({ children }) => <FileStoreTestProvider store={store}>{children}</FileStoreTestProvider>

describe('useCategoryRules', () => {
  it('reads nothing until load is called', () => {
    const { result } = renderHook(() => useCategoryRules(), { wrapper: wrapperFor(new MemoryFileStore()) })
    expect(result.current.rules).toBeNull()
  })

  it('loads an empty list when no rules file exists', async () => {
    const { result } = renderHook(() => useCategoryRules(), { wrapper: wrapperFor(new MemoryFileStore()) })
    await act(async () => {
      await result.current.load()
    })
    expect(result.current.rules).toEqual({ state: 'ready', file: { schemaVersion: 1, rules: [] } })
  })

  it('saves rules and reflects them without another read', async () => {
    const store = new MemoryFileStore()
    const { result } = renderHook(() => useCategoryRules(), { wrapper: wrapperFor(store) })
    const rule = containsRule('r_01', 'starbucks', 'Dining')
    await act(async () => {
      await result.current.load()
      await result.current.change([rule])
    })
    expect(result.current.rules).toMatchObject({ state: 'ready', file: { rules: [rule] } })
    expect(await store.exists(RULES_PATH)).toBe(true)
  })

  it('reports an unreadable file and refuses to overwrite it', async () => {
    const store = new MemoryFileStore()
    await store.writeJSON(RULES_PATH, { schemaVersion: 99, rules: [] })
    const { result } = renderHook(() => useCategoryRules(), { wrapper: wrapperFor(store) })
    let saved: unknown
    await act(async () => {
      await result.current.load()
      saved = await result.current.change([containsRule('r_01', 'x1', 'Dining')])
    })
    expect(result.current.rules).toEqual({ state: 'unreadable', reason: 'newer' })
    expect(saved).toEqual({ ok: false, reason: 'unreadable' })
  })
})
