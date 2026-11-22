import { describe, it, expect } from 'vitest'
import { saveCorruptCopy } from './corruptCopy'
import type { RawEntry, RawIO } from './backupManager'
import { stampFor } from './safetyNet'

const enc = (text: string): Uint8Array => new TextEncoder().encode(text)
const NOW = Date.UTC(2026, 10, 8, 18, 34, 37, 123)

const makeIO = (seed: Record<string, Uint8Array | string> = {}) => {
  const files = new Map<string, Uint8Array>(
    Object.entries(seed).map(([path, value]) => [path, typeof value === 'string' ? enc(value) : value]),
  )
  const writes: string[] = []
  const io: RawIO & { corruptWrites: boolean } = {
    corruptWrites: false,
    async read(path) {
      return files.get(path) ?? null
    },
    async write(path, data) {
      writes.push(path)
      const bytes = typeof data === 'string' ? enc(data) : data
      files.set(path, io.corruptWrites ? bytes.slice(0, Math.max(0, bytes.length - 1)) : bytes)
    },
    async list(dir) {
      const prefix = dir === '' ? '' : `${dir}/`
      const seen = new Map<string, RawEntry>()
      for (const [path, bytes] of files) {
        if (!path.startsWith(prefix)) continue
        const [head, ...rest] = path.slice(prefix.length).split('/')
        if (rest.length > 0) seen.set(head, { name: head, kind: 'directory' })
        else seen.set(head, { name: head, kind: 'file', size: bytes.length })
      }
      return [...seen.values()]
    },
    async remove(path) {
      files.delete(path)
    },
  }
  return { io, files, writes }
}

describe('saveCorruptCopy', () => {
  it('saves the exact bytes next to the original under a stamped name', async () => {
    const { io, files } = makeIO({ 'accounts.json': '{"broken' })
    const bytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x00, 0x22])

    const copyPath = await saveCorruptCopy(io, 'accounts.json', bytes, () => NOW)

    expect(copyPath).toBe(`accounts.json.corrupt-${stampFor(NOW)}`)
    expect(files.get(copyPath)).toEqual(bytes)
  })

  it('keeps the copy in the same folder for nested paths', async () => {
    const { io, files } = makeIO({ 'budget/categories.json': 'x' })
    const copyPath = await saveCorruptCopy(io, 'budget/categories.json', enc('x'), () => NOW)
    expect(copyPath).toBe(`budget/categories.json.corrupt-${stampFor(NOW)}`)
    expect(files.has(copyPath)).toBe(true)
  })

  it('reuses an identical copy instead of piling up duplicates', async () => {
    const { io, writes } = makeIO({ 'accounts.json.corrupt-20260101T000000000Z': '{bad' })
    const copyPath = await saveCorruptCopy(io, 'accounts.json', enc('{bad'), () => NOW)
    expect(copyPath).toBe('accounts.json.corrupt-20260101T000000000Z')
    expect(writes).toEqual([])
  })

  it('makes a new copy when the existing one holds different bytes, and never overwrites it', async () => {
    const { io, files } = makeIO({ 'accounts.json.corrupt-20260101T000000000Z': '{old' })
    const copyPath = await saveCorruptCopy(io, 'accounts.json', enc('{new!'), () => NOW)
    expect(copyPath).not.toBe('accounts.json.corrupt-20260101T000000000Z')
    expect(files.get('accounts.json.corrupt-20260101T000000000Z')).toEqual(enc('{old'))
    expect(files.get(copyPath)).toEqual(enc('{new!'))
  })

  it('compares bytes, not just length, before reusing a copy', async () => {
    const { io, files } = makeIO({ 'accounts.json.corrupt-20260101T000000000Z': '{aaa' })
    const copyPath = await saveCorruptCopy(io, 'accounts.json', enc('{bbb'), () => NOW)
    expect(copyPath).not.toBe('accounts.json.corrupt-20260101T000000000Z')
    expect(files.get(copyPath)).toEqual(enc('{bbb'))
  })

  it('moves to the next millisecond when the stamped name is already taken', async () => {
    const taken = `accounts.json.corrupt-${stampFor(NOW)}`
    const { io, files } = makeIO({ [taken]: 'different' })
    const copyPath = await saveCorruptCopy(io, 'accounts.json', enc('{bad'), () => NOW)
    expect(copyPath).toBe(`accounts.json.corrupt-${stampFor(NOW + 1)}`)
    expect(files.get(taken)).toEqual(enc('different'))
  })

  it('ignores copies of other files', async () => {
    const { io, writes } = makeIO({ 'profile.json.corrupt-20260101T000000000Z': '{bad' })
    await saveCorruptCopy(io, 'accounts.json', enc('{bad'), () => NOW)
    expect(writes).toHaveLength(1)
  })

  it('throws when the copy read back does not match', async () => {
    const { io } = makeIO()
    io.corruptWrites = true
    await expect(saveCorruptCopy(io, 'accounts.json', enc('{bad'), () => NOW)).rejects.toThrow('does not match')
  })

  it('throws when the copy cannot be read back at all', async () => {
    const { io } = makeIO()
    io.write = async () => {}
    await expect(saveCorruptCopy(io, 'accounts.json', enc('{bad'), () => NOW)).rejects.toThrow('does not match')
  })

  it('propagates a write failure', async () => {
    const { io } = makeIO()
    io.write = async () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    await expect(saveCorruptCopy(io, 'accounts.json', enc('{bad'), () => NOW)).rejects.toThrow('full')
  })

  it('removes a partial copy when the write or the check fails', async () => {
    const { io, files } = makeIO()
    io.corruptWrites = true
    await expect(saveCorruptCopy(io, 'accounts.json', enc('{bad'), () => NOW)).rejects.toThrow()
    expect([...files.keys()]).toEqual([])
  })

  it('still reports the original failure when the partial copy cannot be removed either', async () => {
    const { io } = makeIO()
    io.write = async () => {
      throw new Error('disk full')
    }
    io.remove = async () => {
      throw new Error('cannot remove')
    }
    await expect(saveCorruptCopy(io, 'accounts.json', enc('{bad'), () => NOW)).rejects.toThrow('disk full')
  })

  it('uses the real clock by default', async () => {
    const { io, files } = makeIO()
    const copyPath = await saveCorruptCopy(io, 'accounts.json', enc('{bad'))
    expect(copyPath).toMatch(/^accounts\.json\.corrupt-\d{8}T\d{9}Z$/)
    expect(files.has(copyPath)).toBe(true)
  })
})
