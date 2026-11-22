import { describe, it, expect } from 'vitest'
import { containsRule } from '../../../test/importHelpers'
import { MemoryFileStore } from '../../../utils/memoryFileStore'
import { loadRules, retargetStoredRules, RULES_PATH, saveRules } from './importStorage'

const rules = [containsRule('r_01', 'STARBUCKS', 'Dining'), containsRule('r_02', 'shell', 'Gas')]

describe('loadRules', () => {
  it('treats a missing file as an empty list', async () => {
    const result = await loadRules(new MemoryFileStore())
    expect(result).toEqual({ state: 'ready', file: { schemaVersion: 1, rules: [] } })
  })

  it('reads a saved file', async () => {
    const store = new MemoryFileStore()
    await store.writeJSON(RULES_PATH, { schemaVersion: 1, rules })
    expect(await loadRules(store)).toEqual({ state: 'ready', file: { schemaVersion: 1, rules } })
  })

  it.each([
    ['a corrupt file', 'garbage', 'corrupt'],
    ['an invalid rule', { schemaVersion: 1, rules: [{ id: 'x' }] }, 'corrupt'],
    ['a newer schema', { schemaVersion: 2, rules: [] }, 'newer'],
  ])('reports %s as unreadable', async (_, content, reason) => {
    const store = new MemoryFileStore()
    await store.writeJSON(RULES_PATH, content)
    expect(await loadRules(store)).toEqual({ state: 'unreadable', reason })
  })

  it('reports a file that cannot be read at all as corrupt', async () => {
    const store = new MemoryFileStore()
    store.exists = async () => {
      throw new Error('denied')
    }
    expect(await loadRules(store)).toEqual({ state: 'unreadable', reason: 'corrupt' })
  })
})

describe('saveRules', () => {
  it('writes the ordered list with the schema version', async () => {
    const store = new MemoryFileStore()
    expect(await saveRules(store, rules)).toEqual({ ok: true })
    expect(await store.readJSON(RULES_PATH, null)).toEqual({ schemaVersion: 1, rules })
  })

  it.each([
    ['corrupt', 'garbage'],
    ['newer', { schemaVersion: 5, rules: [] }],
  ])('never overwrites a %s file', async (_, content) => {
    const store = new MemoryFileStore()
    await store.writeJSON(RULES_PATH, content)
    expect(await saveRules(store, rules)).toEqual({ ok: false, reason: 'unreadable' })
    expect(await store.readJSON(RULES_PATH, null)).toEqual(content)
  })

  it('reports a failed write', async () => {
    const store = new MemoryFileStore()
    store.writeJSON = async () => {
      throw new Error('disk full')
    }
    expect(await saveRules(store, rules)).toEqual({ ok: false, reason: 'write' })
  })
})

describe('retargetStoredRules', () => {
  it('rewrites rules aimed at merged-away categories', async () => {
    const store = new MemoryFileStore()
    await store.writeJSON(RULES_PATH, { schemaVersion: 1, rules })
    expect(await retargetStoredRules(store, ['Dining'], 'Food')).toEqual({ ok: true })
    const saved = await loadRules(store)
    expect(saved.state === 'ready' && saved.file.rules.map(r => r.category)).toEqual(['Food', 'Gas'])
  })

  it('writes nothing when no rule points at a merged category, or when there is no file', async () => {
    const store = new MemoryFileStore()
    expect(await retargetStoredRules(store, ['Dining'], 'Food')).toEqual({ ok: true })
    expect(await store.exists(RULES_PATH)).toBe(false)
    await store.writeJSON(RULES_PATH, { schemaVersion: 1, rules })
    let writes = 0
    const write = store.writeJSON.bind(store)
    store.writeJSON = async (path, data) => {
      writes++
      return write(path, data)
    }
    expect(await retargetStoredRules(store, ['Travel'], 'Food')).toEqual({ ok: true })
    expect(writes).toBe(0)
  })

  it('leaves an unreadable file alone', async () => {
    const store = new MemoryFileStore()
    await store.writeJSON(RULES_PATH, { schemaVersion: 9, rules: [] })
    expect(await retargetStoredRules(store, ['Dining'], 'Food')).toEqual({ ok: false, reason: 'unreadable' })
    expect(await store.readJSON(RULES_PATH, null)).toEqual({ schemaVersion: 9, rules: [] })
  })
})
