import { corruptPathFor, isCorruptCopyOf, stampFor } from './safetyNet'
import type { RawIO } from './backupManager'

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i])

/**
 * Saves the unreadable bytes of `path` next to it as `<path>.corrupt-<stamp>` and checks the copy by reading it
 * back. An existing copy with identical bytes is reused, so reloading a still-broken file does not pile up
 * duplicates. Never overwrites a file. Throws when the copy cannot be written or does not match.
 */
export async function saveCorruptCopy(
  io: RawIO,
  path: string,
  bytes: Uint8Array,
  now: () => number = Date.now,
): Promise<string> {
  const segments = path.split('/').filter(Boolean)
  const name = segments.pop() ?? ''
  const prefix = segments.length > 0 ? `${segments.join('/')}/` : ''

  const siblings = await io.list(segments.join('/'))
  const copies = siblings.filter(entry => entry.kind === 'file' && isCorruptCopyOf(entry.name, name))
  for (const copy of copies) {
    if (copy.kind !== 'file' || copy.size !== bytes.length) continue
    const existing = await io.read(`${prefix}${copy.name}`)
    if (existing && bytesEqual(existing, bytes)) return `${prefix}${copy.name}`
  }

  const taken = new Set(copies.map(copy => copy.name))
  const time = now()
  let offset = 0
  while (taken.has(corruptPathFor(name, stampFor(time + offset)))) offset += 1
  const copyPath = `${prefix}${corruptPathFor(name, stampFor(time + offset))}`

  try {
    await io.write(copyPath, bytes)
    const written = await io.read(copyPath)
    if (!written || !bytesEqual(written, bytes)) throw new Error(`The copy ${copyPath} does not match the original.`)
  } catch (error) {
    // Do not leave a partial copy behind where it could be mistaken for the real thing.
    await io.remove(copyPath).catch(() => {})
    throw error
  }
  return copyPath
}
