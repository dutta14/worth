import {
  BACKUPS_DIR,
  backupDirFor,
  backupPathFor,
  isBackupEligible,
  parseBackupName,
  pruneList,
  stampFor,
} from './safetyNet'
import type { BackupEntry, BackupTag } from './safetyNet'

export type RawEntry = { name: string; kind: 'directory' } | { name: string; kind: 'file'; size: number }

/** The few raw file operations the backup manager needs, so it can run over a Map in tests. */
export interface RawIO {
  /** `null` when the file does not exist. */
  read(path: string): Promise<Uint8Array | null>
  /** Creates missing folders. */
  write(path: string, data: Uint8Array | string): Promise<void>
  /** `[]` when the folder does not exist. */
  list(dir: string): Promise<RawEntry[]>
  /** A missing file is not an error. */
  remove(path: string): Promise<void>
}

export interface SnapshotOptions {
  tag?: BackupTag
  /** Skips the once-per-session rule; identical bytes are still not duplicated. */
  force?: boolean
}

export interface BackupManager {
  /** True when the once-per-session (or 6 h refresh) rule wants a copy of this path now. */
  isDue(path: string): boolean
  /** Copies `bytes` into `_backups/`. Resolves `null` when nothing was written. Throws when the copy fails. */
  snapshot(path: string, bytes: Uint8Array, options?: SnapshotOptions): Promise<BackupEntry | null>
  /** Every copy in `_backups/`, newest first. */
  list(): Promise<BackupEntry[]>
  /** Deletes all but the newest copies of one file. */
  prune(path: string): Promise<void>
  /**
   * Replaces the file with the backup. The current bytes are copied aside first unless the caller already
   * holds a copy of them (`snapshotCurrent: false`). The caller notifies the app.
   */
  restore(entry: BackupEntry, options?: RestoreOptions): Promise<void>
  /**
   * The newest copy of `path` whose bytes parse as JSON. Regular copies win over `-unsaved` ones, which are
   * only the user's discarded edits, so they are used only when nothing else exists.
   */
  latestValid(path: string): Promise<BackupEntry | null>
  /** True when some copy of `path` in `_backups/` holds exactly these bytes. */
  hasCopy(path: string, bytes: Uint8Array): Promise<boolean>
}

export interface RestoreOptions {
  snapshotCurrent?: boolean
}

const README_PATH = `${BACKUPS_DIR}/README.txt`
const README_TEXT =
  'These are automatic copies made by worth before a file was changed. The newest 10 copies of each file are kept. ' +
  'You can delete this folder at any time. To restore a copy, use Settings > Data Folder > Backups, or copy the file ' +
  'back yourself.\n'

/** Copies are refreshed once per session, then again after this long. */
const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i])

export function createBackupManager(io: RawIO, now: () => number = Date.now): BackupManager {
  const lastSnapshotAt = new Map<string, number>()
  let ready: Promise<void> | null = null
  let disabled = false

  // A `_backups` entry that is a file (or cannot be created) turns backups off for the session.
  const ensureReady = (): Promise<void> => {
    ready ??= (async () => {
      try {
        if ((await io.read(README_PATH)) === null) await io.write(README_PATH, README_TEXT)
      } catch (error) {
        disabled = true
        throw error
      }
    })()
    return ready
  }

  const copiesOf = async (path: string): Promise<BackupEntry[]> => {
    const dir = backupDirFor(path)
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    const entries = await io.list(dir)
    const copies: BackupEntry[] = []
    for (const entry of entries) {
      if (entry.kind !== 'file') continue
      const parsed = parseBackupName(entry.name)
      if (!parsed || parsed.ext !== ext) continue
      copies.push({
        path,
        backupPath: `${dir}/${entry.name}`,
        stamp: parsed.stamp,
        unsaved: parsed.unsaved,
        size: entry.size,
      })
    }
    return copies
  }

  const prune = async (path: string): Promise<void> => {
    for (const stale of pruneList(await copiesOf(path))) await io.remove(stale.backupPath)
  }

  const isDue = (path: string): boolean => {
    if (disabled || !isBackupEligible(path)) return false
    const last = lastSnapshotAt.get(path)
    return last === undefined || now() - last >= REFRESH_AFTER_MS
  }

  const snapshot = async (
    path: string,
    bytes: Uint8Array,
    { tag, force = false }: SnapshotOptions = {},
  ): Promise<BackupEntry | null> => {
    if (!isBackupEligible(path) || bytes.length === 0) return null
    if (disabled) {
      if (force || tag) throw new Error('Backups are unavailable for this folder.')
      return null
    }
    if (!force && !tag && !isDue(path)) return null
    await ensureReady()

    const existing = await copiesOf(path)
    const newest = [...existing].sort((a, b) => (a.stamp < b.stamp ? 1 : -1))[0]
    if (newest && newest.size === bytes.length) {
      const previous = await io.read(newest.backupPath)
      if (previous && bytesEqual(previous, bytes)) {
        lastSnapshotAt.set(path, now())
        return null
      }
    }

    const taken = new Set(existing.map(copy => copy.stamp))
    const time = now()
    let offset = 0
    while (taken.has(stampFor(time + offset))) offset += 1
    const stamp = stampFor(time + offset)
    const backupPath = backupPathFor(path, stamp, tag)
    await io.write(backupPath, bytes)
    lastSnapshotAt.set(path, time)
    try {
      await prune(path)
    } catch (error) {
      // The new copy is safe; an old one lingering is harmless and the next snapshot prunes again.
      console.error('Backup prune failed:', error)
    }
    return { path, backupPath, stamp, unsaved: tag === 'unsaved', size: bytes.length }
  }

  const walk = async (dir: string, segments: string[], found: BackupEntry[]): Promise<void> => {
    for (const entry of await io.list(dir)) {
      if (entry.kind === 'directory') {
        await walk(`${dir}/${entry.name}`, [...segments, entry.name], found)
        continue
      }
      const parsed = parseBackupName(entry.name)
      if (!parsed || segments.length === 0) continue
      found.push({
        path: `${segments.join('/')}.${parsed.ext}`,
        backupPath: `${dir}/${entry.name}`,
        stamp: parsed.stamp,
        unsaved: parsed.unsaved,
        size: entry.size,
      })
    }
  }

  const list = async (): Promise<BackupEntry[]> => {
    const found: BackupEntry[] = []
    await walk(BACKUPS_DIR, [], found)
    return found.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : a.path.localeCompare(b.path)))
  }

  const restore = async (entry: BackupEntry, { snapshotCurrent = true }: RestoreOptions = {}): Promise<void> => {
    if (!isBackupEligible(entry.path) || !entry.backupPath.startsWith(`${BACKUPS_DIR}/`)) {
      throw new Error(`Cannot restore ${entry.path}.`)
    }
    const bytes = await io.read(entry.backupPath)
    if (bytes === null) throw new Error(`The backup ${entry.backupPath} no longer exists.`)
    if (snapshotCurrent) {
      const current = await io.read(entry.path)
      if (current && current.length > 0) await snapshot(entry.path, current, { force: true })
    }
    await io.write(entry.path, bytes)
  }

  const parses = async (entry: BackupEntry): Promise<boolean> => {
    try {
      const bytes = await io.read(entry.backupPath)
      if (!bytes || bytes.length === 0) return false
      JSON.parse(new TextDecoder().decode(bytes))
      return true
    } catch {
      return false
    }
  }

  const latestValid = async (path: string): Promise<BackupEntry | null> => {
    if (disabled || !isBackupEligible(path) || !path.toLowerCase().endsWith('.json')) return null
    const newestFirst = (await copiesOf(path)).sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0))
    for (const entry of [...newestFirst.filter(copy => !copy.unsaved), ...newestFirst.filter(copy => copy.unsaved)]) {
      if (await parses(entry)) return entry
    }
    return null
  }

  const hasCopy = async (path: string, bytes: Uint8Array): Promise<boolean> => {
    if (!isBackupEligible(path)) return false
    for (const copy of await copiesOf(path)) {
      if (copy.size !== bytes.length) continue
      const stored = await io.read(copy.backupPath)
      if (stored && bytesEqual(stored, bytes)) return true
    }
    return false
  }

  return { isDue, snapshot, list, prune, restore, latestValid, hasCopy }
}

const isNotFound = (error: unknown): boolean => (error as { name?: string } | null)?.name === 'NotFoundError'

/** `RawIO` over a File System Access directory handle. */
export function createHandleIO(root: FileSystemDirectoryHandle): RawIO {
  const resolveDir = async (segments: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> => {
    let current = root
    for (const segment of segments) {
      try {
        current = await current.getDirectoryHandle(segment, { create })
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    }
    return current
  }
  const split = (path: string): { dirs: string[]; name: string } => {
    const segments = path.split('/').filter(Boolean)
    const name = segments.pop() ?? ''
    return { dirs: segments, name }
  }

  return {
    async read(path) {
      const { dirs, name } = split(path)
      const dir = await resolveDir(dirs, false)
      if (!dir) return null
      try {
        const file = await (await dir.getFileHandle(name)).getFile()
        return new Uint8Array(await file.arrayBuffer())
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },
    async write(path, data) {
      const { dirs, name } = split(path)
      const dir = await resolveDir(dirs, true)
      if (!dir) throw new Error(`Cannot create the folder for ${path}.`)
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await writable.write(typeof data === 'string' ? data : new Blob([data.slice()]))
      await writable.close()
    },
    async list(path) {
      const dir = await resolveDir(path.split('/').filter(Boolean), false)
      if (!dir) return []
      const entries: RawEntry[] = []
      try {
        for await (const entry of dir.values()) {
          if (entry.kind === 'directory') entries.push({ name: entry.name, kind: 'directory' })
          else
            entries.push({
              name: entry.name,
              kind: 'file',
              size: (await (entry as FileSystemFileHandle).getFile()).size,
            })
        }
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      return entries
    },
    async remove(path) {
      const { dirs, name } = split(path)
      const dir = await resolveDir(dirs, false)
      if (!dir) return
      try {
        await dir.removeEntry(name)
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    },
  }
}
