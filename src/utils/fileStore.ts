import type { FileStore, SafetyNetStore } from './fileStoreTypes'
import { parseCSV, serializeCSV } from './csvUtils'
import { createBackupManager, createHandleIO } from './backupManager'
import type { BackupManager } from './backupManager'
import { saveCorruptCopy } from './corruptCopy'
import { EMPTY_SAFETY_SNAPSHOT, FileStoreError, errorKind, isBackupEligible, snapshotsEqual } from './safetyNet'
import type { BackupEntry, CorruptAction, SafetySnapshot, WriteFailureKind } from './safetyNet'

const CHANNEL_NAME = 'filestore-sync'
const WRITE_DEBOUNCE_MS = 300
/** Used only once the safety net is enabled; shrinks the window for a write lost on tab close. */
const SAFE_WRITE_DEBOUNCE_MS = 120

type Payload = { kind: 'text'; value: string } | { kind: 'binary'; value: ArrayBuffer }

interface FailedWrite {
  payload: Payload
  kind: WriteFailureKind
}

/** A JSON file that did not parse. Its bytes are kept in memory until the user resolves it. */
interface CorruptEntry {
  bytes: Uint8Array
  copyPath: string | null
  hasBackup: boolean
  /** False until the copy and the backup lookup have finished, so the banner never shows a half-known state. */
  ready: boolean
  settled: Promise<void>
}

interface PendingWrite {
  timer: ReturnType<typeof setTimeout>
  payload: Payload
  waiters: { resolve: () => void; reject: (reason: unknown) => void }[]
}

const isNotFound = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'NotFoundError'
    : (error as { name?: string })?.name === 'NotFoundError'

const isJsonPath = (path: string): boolean => path.toLowerCase().endsWith('.json')

/**
 * JSON files whose loss matters. Derived caches (`budget/summary-cache.json`) and anything else that is not
 * backup-eligible behave as before: a bad read falls back and the next write replaces it.
 */
const isGuardedPath = (path: string): boolean => isJsonPath(path) && isBackupEligible(path)

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i])

const splitPath = (path: string): { dirs: string[]; name: string } => {
  const segments = path.split('/').filter(Boolean)
  const name = segments.pop() ?? ''
  return { dirs: segments, name }
}

async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) return fn()
  return locks.request(name, fn) as Promise<T>
}

/**
 * FileStore backed by the File System Access API.
 *
 * Reads are cached in memory; writes are debounced per path (300ms), guarded
 * by a `navigator.locks` lock so concurrent tabs never interleave, and
 * announced on a BroadcastChannel so other tabs drop their stale cache.
 *
 * The data safety net (`SafetyNetStore`) is inert until `configureSafety` is
 * called with `enabled: true`: legacy timing and behavior are unchanged until then.
 */
export class FileSystemFileStore implements FileStore, SafetyNetStore {
  private root: FileSystemDirectoryHandle | null = null
  private cache = new Map<string, unknown>()
  private pending = new Map<string, PendingWrite>()
  private subscribers = new Map<string, Set<() => void>>()
  private channel: BroadcastChannel | null = null
  private safetyEnabled = false
  private failed = new Map<string, FailedWrite>()
  private inFlight = new Map<string, number>()
  private permissionLost = false
  private backupsHealthy = true
  private backupManager: BackupManager | null = null
  private safetySnapshot: SafetySnapshot = EMPTY_SAFETY_SNAPSHOT
  private safetySubscribers = new Set<() => void>()
  private corrupt = new Map<string, CorruptEntry>()
  /** Latest payload for each path whose write was refused because the file on disk is corrupt. */
  private held = new Map<string, Payload>()
  /** JSON paths whose bytes on disk are known to parse, so a write needs no check first. */
  private verified = new Set<string>()
  /** Paths the user resolved while the bytes on disk may still be unreadable; not flagged again until rewritten. */
  private acknowledged = new Set<string>()
  private resolving = new Map<string, Promise<BackupEntry | null>>()

  async init(handle: FileSystemDirectoryHandle): Promise<void> {
    this.root = handle
    this.cache.clear()
    this.failed.clear()
    this.permissionLost = false
    this.backupsHealthy = true
    this.backupManager = null
    this.resetCorruptState()
    this.refreshSafetySnapshot()
    this.setupChannel()
  }

  getHandle(): FileSystemDirectoryHandle | null {
    return this.root
  }

  subscribe(path: string, cb: () => void): () => void {
    let set = this.subscribers.get(path)
    if (!set) {
      set = new Set()
      this.subscribers.set(path, set)
    }
    set.add(cb)
    return () => {
      this.subscribers.get(path)?.delete(cb)
    }
  }

  async readJSON<T>(path: string, fallback: T): Promise<T> {
    if (this.cache.has(path)) return this.cache.get(path) as T
    const guarded = this.safetyEnabled
    const read = guarded ? await this.readTextAndBytes(path) : { text: await this.readText(path), bytes: null }
    if (read.text === null) return fallback
    try {
      const parsed = JSON.parse(read.text) as T
      this.cache.set(path, parsed)
      if (guarded) this.markReadable(path)
      return parsed
    } catch {
      // Zero-byte and whitespace-only files count as missing: a sync client may have left a placeholder.
      if (guarded && read.bytes && read.text.trim() !== '' && isGuardedPath(path) && !this.acknowledged.has(path)) {
        this.markCorrupt(path, read.bytes)
      }
      return fallback
    }
  }

  async writeJSON(path: string, data: unknown): Promise<void> {
    const serialized = JSON.stringify(data, null, 2)
    if (serialized === undefined) {
      console.error(`FileStore.writeJSON: value for "${path}" is not serializable`)
      return
    }
    this.cache.set(path, data)
    return this.queueWrite(path, { kind: 'text', value: serialized })
  }

  async readCSV(path: string): Promise<string[][]> {
    const cached = this.cache.get(path)
    if (Array.isArray(cached)) return cached as string[][]
    const text = await this.readText(path)
    if (text === null) return []
    const rows = parseCSV(text)
    this.cache.set(path, rows)
    return rows
  }

  async writeCSV(path: string, rows: string[][]): Promise<void> {
    this.cache.set(path, rows)
    return this.queueWrite(path, { kind: 'text', value: serializeCSV(rows) })
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const cached = this.cache.get(path)
    if (cached instanceof ArrayBuffer) return cached
    const file = await this.readFile(path)
    if (file === null) return null
    const buffer = await file.arrayBuffer()
    this.cache.set(path, buffer)
    return buffer
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.cache.set(path, data)
    return this.queueWrite(path, { kind: 'binary', value: data })
  }

  async exists(path: string): Promise<boolean> {
    if (this.cache.has(path)) return true
    if (!this.root) return false
    const { dirs, name } = splitPath(path)
    const dir = await this.resolveDir(dirs, false)
    if (!dir) return false
    try {
      await dir.getFileHandle(name)
      return true
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }
  }

  async listFiles(dir: string): Promise<string[]> {
    if (!this.root) return []
    const segments = dir.split('/').filter(Boolean)
    const handle = await this.resolveDir(segments, false)
    if (!handle) return []
    const names: string[] = []
    try {
      for await (const entry of handle.values()) {
        names.push(entry.name)
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    return names.sort()
  }

  async delete(path: string): Promise<void> {
    this.cache.delete(path)
    if (this.failed.delete(path)) this.refreshSafetySnapshot()
    const queued = this.pending.get(path)
    if (queued) {
      clearTimeout(queued.timer)
      this.pending.delete(path)
      queued.waiters.forEach(w => w.resolve())
    }
    if (!this.root) return
    const { dirs, name } = splitPath(path)
    const dir = await this.resolveDir(dirs, false)
    if (!dir) return
    try {
      await withLock(`filestore:${path}`, async () => {
        const unreadable = this.corrupt.get(path)
        if (unreadable) await this.preserveCorruptBytes(path, unreadable)
        // Always copy before a delete: a snapshot taken earlier this session may already be out of date.
        await this.snapshotBeforeWrite(dir, name, path, true)
        await dir.removeEntry(name)
        if (unreadable) {
          this.clearCorrupt(path)
          this.refreshSafetySnapshot()
        }
      })
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    this.announce(path)
  }

  /** Flushes any debounced writes immediately. */
  async flush(): Promise<void> {
    const paths = [...this.pending.keys()]
    await Promise.all(
      paths.map(path => {
        const entry = this.pending.get(path)
        if (!entry) return Promise.resolve()
        clearTimeout(entry.timer)
        return this.flushPath(path)
      }),
    )
  }

  /* ── Safety net ───────────────────────────────────────────── */

  configureSafety(opts: { enabled: boolean }): void {
    this.safetyEnabled = opts.enabled
    if (opts.enabled) return
    this.failed.clear()
    this.resetCorruptState()
    this.permissionLost = false
    this.backupsHealthy = true
    this.refreshSafetySnapshot()
  }

  getSafetySnapshot(): SafetySnapshot {
    return this.safetySnapshot
  }

  subscribeSafety(cb: () => void): () => void {
    this.safetySubscribers.add(cb)
    return () => {
      this.safetySubscribers.delete(cb)
    }
  }

  hasUnsavedWork(): boolean {
    return this.pending.size > 0 || this.inFlight.size > 0 || this.failed.size > 0 || this.held.size > 0
  }

  /** Re-queues every failed payload immediately; resolves once each attempt has settled. */
  async retryFailed(): Promise<void> {
    if (!this.safetyEnabled) return
    const retries = [...this.failed].filter(([path]) => !this.pending.has(path))
    await Promise.allSettled(retries.map(([path, { payload }]) => this.queueWrite(path, payload, 0)))
  }

  async checkPermission(): Promise<void> {
    const root = this.root
    if (!this.safetyEnabled || !root?.queryPermission) return
    let state: PermissionState
    try {
      state = await root.queryPermission({ mode: 'readwrite' })
    } catch (error) {
      console.error('FileStore permission check failed:', error)
      return
    }
    if (!this.safetyEnabled) return
    if (state !== 'granted') {
      this.setPermissionLost(true)
      return
    }
    this.setPermissionLost(false)
    if (this.failed.size > 0) await this.retryFailed()
  }

  async requestReconnect(): Promise<PermissionState> {
    const root = this.root
    if (!root) return 'denied'
    const state = (await root.requestPermission?.({ mode: 'readwrite' })) ?? 'granted'
    if (state === 'granted') {
      this.setPermissionLost(false)
      await this.retryFailed()
    }
    return state
  }

  /** Every copy in `_backups/`, newest first. */
  async listBackups(): Promise<BackupEntry[]> {
    return this.requireBackups().list()
  }

  /**
   * Replaces a file with one of its backups. The current disk version is copied aside first, and any edit
   * still waiting to be saved is kept as an `-unsaved` copy, so nothing is lost. The file is untouched if
   * any step fails.
   */
  async restoreBackup(entry: BackupEntry): Promise<void> {
    const backups = this.requireBackups()
    const path = entry.path
    // Taken before the lock so a debounced write cannot land after the restore and undo it.
    const queued = this.pending.get(path)
    if (queued) {
      clearTimeout(queued.timer)
      this.pending.delete(path)
    }
    // A write that already failed lives only in `failed`, so it needs the same protection as a queued one.
    const unsaved = queued?.payload ?? this.failed.get(path)?.payload ?? this.held.get(path)
    try {
      await withLock(`filestore:${path}`, async () => {
        if (unsaved?.kind === 'text') {
          await backups.snapshot(path, new TextEncoder().encode(unsaved.value), { tag: 'unsaved', force: true })
        }
        await backups.restore(entry)
      })
    } catch (error) {
      if (queued) this.requeue(path, queued)
      throw error
    }
    queued?.waiters.forEach(w => w.resolve())
    this.cache.delete(path)
    // A restore replaces whatever was wrong with the file, so a corrupt hold on it ends here.
    const hadHold = this.corrupt.has(path)
    this.clearCorrupt(path)
    this.acknowledged.add(path)
    if (this.failed.delete(path) || hadHold) this.refreshSafetySnapshot()
    this.setBackupsHealthy(true)
    this.announce(path)
  }

  /**
   * Ends the hold on a corrupt JSON file. The unreadable bytes are copied aside first (to a `.corrupt-` file,
   * or to `_backups/` when that fails) and the file is left alone if neither copy can be made.
   */
  resolveCorrupt(path: string, action: CorruptAction): Promise<BackupEntry | null> {
    const running = this.resolving.get(path)
    if (running) return running
    const attempt = this.runResolveCorrupt(path, action).finally(() => this.resolving.delete(path))
    this.resolving.set(path, attempt)
    return attempt
  }

  private async runResolveCorrupt(path: string, action: CorruptAction): Promise<BackupEntry | null> {
    const entry = this.corrupt.get(path)
    if (!entry || !this.safetyEnabled || !this.root) return null
    await entry.settled
    let restoredFrom: BackupEntry | null = null
    await withLock(`filestore:${path}`, async () => {
      if (this.corrupt.get(path) !== entry) return
      await this.preserveCorruptBytes(path, entry)
      const held = this.held.get(path)
      if (action === 'restore-latest') {
        const backups = this.requireBackups()
        const latest = await backups.latestValid(path)
        if (!latest) throw new Error(`There is no valid backup of ${path}.`)
        if (held?.kind === 'text') {
          await backups.snapshot(path, new TextEncoder().encode(held.value), { tag: 'unsaved', force: true })
        }
        await backups.restore(latest, { snapshotCurrent: false })
        restoredFrom = latest
      } else if (held) {
        const { dirs, name } = splitPath(path)
        const dir = await this.resolveDir(dirs, true)
        if (!dir) throw new Error(`Cannot open the folder for ${path}.`)
        await this.writePayload(dir, name, held)
      }
      this.clearCorrupt(path)
      this.acknowledged.add(path)
    })
    if (this.corrupt.has(path)) return null
    if (restoredFrom) this.cache.delete(path)
    this.refreshSafetySnapshot()
    this.announce(path)
    return restoredFrom
  }

  /** Makes sure what is on disk right now is saved somewhere else before the file is replaced or removed. */
  private async preserveCorruptBytes(path: string, entry: CorruptEntry): Promise<void> {
    const root = this.root
    if (!root) return
    const io = createHandleIO(root)
    const current = await io.read(path)
    if (current === null || current.length === 0) return
    if (entry.copyPath !== null && bytesEqual(current, entry.bytes)) return
    try {
      entry.copyPath = await saveCorruptCopy(io, path, current)
      entry.bytes = current
      return
    } catch (error) {
      console.error(`FileStore corrupt copy of "${path}" failed:`, error)
    }
    // Last resort: the backups folder, so the bytes are never replaced without a second copy.
    const backups = this.getBackups()
    if (!backups) throw new Error(`Could not save a copy of ${path}, so it was left untouched.`)
    await backups.snapshot(path, current, { force: true })
    // `snapshot` also resolves null when it wrote nothing; that is only fine if a copy already holds these bytes.
    if (!(await backups.hasCopy(path, current))) {
      throw new Error(`Could not save a copy of ${path}, so it was left untouched.`)
    }
    entry.bytes = current
  }

  private markReadable(path: string): void {
    this.verified.add(path)
    this.acknowledged.delete(path)
    const entry = this.corrupt.get(path)
    // The file parses now (fixed outside the app); a held edit still needs the user's say before it lands.
    if (entry && !this.held.has(path)) {
      this.corrupt.delete(path)
      this.refreshSafetySnapshot()
    }
  }

  private markCorrupt(path: string, bytes: Uint8Array): void {
    this.verified.delete(path)
    if (this.corrupt.has(path)) return
    const entry: CorruptEntry = { bytes, copyPath: null, hasBackup: false, ready: false, settled: Promise.resolve() }
    this.corrupt.set(path, entry)
    entry.settled = this.quarantine(path, entry)
  }

  private async quarantine(path: string, entry: CorruptEntry): Promise<void> {
    const root = this.root
    if (root) {
      try {
        entry.copyPath = await saveCorruptCopy(createHandleIO(root), path, entry.bytes)
      } catch (error) {
        console.error(`FileStore corrupt copy of "${path}" failed:`, error)
      }
      try {
        entry.hasBackup = (await this.getBackups()?.latestValid(path)) != null
      } catch (error) {
        console.error(`FileStore backup lookup for "${path}" failed:`, error)
      }
    }
    if (this.corrupt.get(path) !== entry) return
    entry.ready = true
    this.refreshSafetySnapshot()
  }

  private clearCorrupt(path: string): void {
    this.corrupt.delete(path)
    this.held.delete(path)
  }

  private resetCorruptState(): void {
    this.corrupt.clear()
    this.held.clear()
    this.verified.clear()
    this.acknowledged.clear()
    this.resolving.clear()
  }

  private requireBackups(): BackupManager {
    const backups = this.getBackups()
    if (!backups) throw new Error('Backups are not available.')
    return backups
  }

  private getBackups(): BackupManager | null {
    if (!this.safetyEnabled || !this.root) return null
    this.backupManager ??= createBackupManager(createHandleIO(this.root))
    return this.backupManager
  }

  private setBackupsHealthy(value: boolean): void {
    if (this.backupsHealthy === value) return
    this.backupsHealthy = value
    this.refreshSafetySnapshot()
  }

  /**
   * Copies the bytes on disk into `_backups/` right before they are overwritten or deleted. A failed copy
   * is reported through `backupsHealthy` and never blocks the user's write.
   */
  private async snapshotBeforeWrite(
    dir: FileSystemDirectoryHandle,
    name: string,
    path: string,
    force = false,
  ): Promise<void> {
    const backups = this.getBackups()
    // Checked first so a binary or tax document is never read just to be skipped.
    if (!backups || !isBackupEligible(path) || (!force && !backups.isDue(path))) return
    try {
      let file: File
      try {
        file = await (await dir.getFileHandle(name)).getFile()
      } catch (error) {
        if (isNotFound(error)) return
        throw error
      }
      await backups.snapshot(path, new Uint8Array(await file.arrayBuffer()), { force })
      this.setBackupsHealthy(true)
    } catch (error) {
      console.error(`FileStore backup of "${path}" failed:`, error)
      this.setBackupsHealthy(false)
    }
  }

  private requeue(path: string, entry: PendingWrite): void {
    const newer = this.pending.get(path)
    if (newer) {
      newer.waiters.push(...entry.waiters)
      return
    }
    entry.timer = setTimeout(() => void this.flushPath(path), SAFE_WRITE_DEBOUNCE_MS)
    this.pending.set(path, entry)
  }

  private setPermissionLost(value: boolean): void {
    if (this.permissionLost === value) return
    this.permissionLost = value
    this.refreshSafetySnapshot()
  }

  private recordFailure(path: string, payload: Payload, error: unknown): void {
    if (!this.safetyEnabled) return
    const kind = errorKind(error)
    // A newer edit queued while this write was in flight supersedes it.
    this.failed.set(path, { payload: this.pending.get(path)?.payload ?? payload, kind })
    if (kind === 'permission') this.permissionLost = true
    this.refreshSafetySnapshot()
  }

  private clearFailure(path: string): void {
    if (this.pending.has(path) || !this.failed.delete(path)) return
    this.refreshSafetySnapshot()
  }

  private refreshSafetySnapshot(): void {
    const next: SafetySnapshot = {
      failed: [...this.failed].map(([path, { kind }]) => ({ path, kind })),
      corrupt: [...this.corrupt]
        .filter(([, entry]) => entry.ready)
        .map(([path, { copyPath, hasBackup }]) => ({ path, copyPath, hasBackup })),
      permissionLost: this.permissionLost,
      backupsHealthy: this.backupsHealthy,
    }
    if (snapshotsEqual(next, this.safetySnapshot)) return
    this.safetySnapshot =
      next.failed.length === 0 && next.corrupt.length === 0 && !next.permissionLost && next.backupsHealthy
        ? EMPTY_SAFETY_SNAPSHOT
        : next
    for (const cb of this.safetySubscribers) {
      try {
        cb()
      } catch (error) {
        console.error('FileStore safety subscriber error:', error)
      }
    }
  }

  /* ── Internals ─────────────────────────────────────────────── */

  private setupChannel(): void {
    if (this.channel || typeof BroadcastChannel === 'undefined') return
    this.channel = new BroadcastChannel(CHANNEL_NAME)
    this.channel.onmessage = (event: MessageEvent<{ path?: string }>) => {
      const path = event.data?.path
      if (!path) return
      this.cache.delete(path)
      this.notify(path)
    }
  }

  private notify(path: string): void {
    const subs = this.subscribers.get(path)
    if (!subs) return
    for (const cb of subs) {
      try {
        cb()
      } catch (error) {
        console.error('FileStore subscriber error:', error)
      }
    }
  }

  private announce(path: string): void {
    this.notify(path)
    try {
      this.channel?.postMessage({ path })
    } catch (error) {
      console.error('FileStore broadcast error:', error)
    }
  }

  private async resolveDir(segments: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    if (!this.root) return null
    let current = this.root
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

  private async readFile(path: string): Promise<File | null> {
    if (!this.root) return null
    const { dirs, name } = splitPath(path)
    const dir = await this.resolveDir(dirs, false)
    if (!dir) return null
    try {
      const handle = await dir.getFileHandle(name)
      return await handle.getFile()
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  private async readText(path: string): Promise<string | null> {
    const file = await this.readFile(path)
    return file === null ? null : file.text()
  }

  /** Reads the raw bytes once so a file that fails to parse can be copied exactly as it was. */
  private async readTextAndBytes(path: string): Promise<{ text: string | null; bytes: Uint8Array | null }> {
    const file = await this.readFile(path)
    if (file === null) return { text: null, bytes: null }
    const bytes = new Uint8Array(await file.arrayBuffer())
    return { text: new TextDecoder().decode(bytes), bytes }
  }

  private queueWrite(path: string, payload: Payload, delay?: number): Promise<void> {
    const debounce = delay ?? (this.safetyEnabled ? SAFE_WRITE_DEBOUNCE_MS : WRITE_DEBOUNCE_MS)
    const failedEntry = this.failed.get(path)
    // The newest edit replaces the failed payload so an older value is never retried over it.
    if (failedEntry) failedEntry.payload = payload
    return new Promise<void>((resolve, reject) => {
      const existing = this.pending.get(path)
      if (existing) {
        clearTimeout(existing.timer)
        existing.payload = payload
        existing.waiters.push({ resolve, reject })
        existing.timer = setTimeout(() => void this.flushPath(path), debounce)
        return
      }
      this.pending.set(path, {
        payload,
        waiters: [{ resolve, reject }],
        timer: setTimeout(() => void this.flushPath(path), debounce),
      })
    })
  }

  private async flushPath(path: string): Promise<void> {
    const entry = this.pending.get(path)
    if (!entry) return
    this.pending.delete(path)
    this.inFlight.set(path, (this.inFlight.get(path) ?? 0) + 1)
    try {
      await this.persist(path, entry.payload)
    } catch (error) {
      this.releaseInFlight(path)
      if (error instanceof FileStoreError) {
        this.held.set(path, entry.payload)
        // A path is held or failed, never both: otherwise the write-failed banner would outrank the corrupt one.
        if (this.failed.delete(path)) this.refreshSafetySnapshot()
      } else this.recordFailure(path, entry.payload, error)
      entry.waiters.forEach(w => w.reject(error))
      return
    }
    this.releaseInFlight(path)
    this.clearFailure(path)
    this.announce(path)
    entry.waiters.forEach(w => w.resolve())
  }

  private releaseInFlight(path: string): void {
    const remaining = (this.inFlight.get(path) ?? 1) - 1
    if (remaining > 0) this.inFlight.set(path, remaining)
    else this.inFlight.delete(path)
  }

  private async persist(path: string, payload: Payload): Promise<void> {
    if (!this.root) return
    const { dirs, name } = splitPath(path)
    await withLock(`filestore:${path}`, async () => {
      const dir = await this.resolveDir(dirs, true)
      if (!dir) return
      await this.assertNotCorrupt(dir, name, path, payload)
      await this.snapshotBeforeWrite(dir, name, path)
      await this.writePayload(dir, name, payload)
      if (this.safetyEnabled && payload.kind === 'text' && isJsonPath(path)) this.markReadable(path)
    })
  }

  private async writePayload(dir: FileSystemDirectoryHandle, name: string, payload: Payload): Promise<void> {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(payload.kind === 'text' ? payload.value : new Blob([payload.value]))
    await writable.close()
  }

  /**
   * Refuses to overwrite a JSON file that does not parse. A path never read this session (or read before the
   * safety net switched on) is checked once, so a blind write cannot replace bytes nobody has looked at.
   */
  private async assertNotCorrupt(
    dir: FileSystemDirectoryHandle,
    name: string,
    path: string,
    payload: Payload,
  ): Promise<void> {
    if (!this.safetyEnabled || payload.kind !== 'text' || !isGuardedPath(path)) return
    if (!this.corrupt.has(path)) {
      if (this.verified.has(path) || this.acknowledged.has(path)) return
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer())
      } catch (error) {
        if (isNotFound(error)) return
        throw error
      }
      const text = new TextDecoder().decode(bytes)
      try {
        if (text.trim() !== '') JSON.parse(text)
        this.verified.add(path)
        return
      } catch {
        this.markCorrupt(path, bytes)
      }
    }
    throw new FileStoreError('corrupt-blocked', `${path} is not valid JSON, so the write was held.`)
  }
}

/** Shared app-wide instance. Uninitialized until a folder is picked. */
export const createFileStore = (): FileStore => new FileSystemFileStore()

export default FileSystemFileStore
