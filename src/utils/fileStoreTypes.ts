import type { BackupEntry, CorruptAction, SafetySnapshot } from './safetyNet'

/**
 * FileStore — the storage abstraction the whole app writes through.
 *
 * Two implementations exist:
 *  - `FileSystemFileStore` (src/utils/fileStore.ts) — backed by the File
 *    System Access API, writing real files into a user-chosen folder.
 *  - `MemoryFileStore` (src/utils/memoryFileStore.ts) — backed by a Map,
 *    used by tests and by demo mode.
 *
 * All paths are POSIX-style, relative to the store root, e.g.
 * `accounts.json`, `balances/2024.csv`, `taxes/2023/files/w2.pdf`.
 */
export interface FileStore {
  init(handle: FileSystemDirectoryHandle): Promise<void>
  readJSON<T>(path: string, fallback: T): Promise<T>
  writeJSON(path: string, data: unknown): Promise<void>
  readCSV(path: string): Promise<string[][]>
  writeCSV(path: string, rows: string[][]): Promise<void>
  readBinary(path: string): Promise<ArrayBuffer | null>
  writeBinary(path: string, data: ArrayBuffer): Promise<void>
  exists(path: string): Promise<boolean>
  listFiles(dir: string): Promise<string[]>
  delete(path: string): Promise<void>
  getHandle(): FileSystemDirectoryHandle | null
  subscribe(path: string, cb: () => void): () => void
}

/**
 * Optional capability implemented by `FileSystemFileStore` only. It stays inert
 * until `configureSafety({ enabled: true })`, and `MemoryFileStore` never has it,
 * so demo and e2e modes cannot touch a real folder.
 */
export interface SafetyNetStore {
  configureSafety(opts: { enabled: boolean }): void
  /** Referentially stable until something changes. */
  getSafetySnapshot(): SafetySnapshot
  subscribeSafety(cb: () => void): () => void
  flush(): Promise<void>
  /** True while a write is pending, in flight, or failed and not yet re-saved. */
  hasUnsavedWork(): boolean
  retryFailed(): Promise<void>
  /** Re-checks folder permission; no-op when disabled. Safe to call on focus. */
  checkPermission(): Promise<void>
  /** Must run inside a user gesture. */
  requestReconnect(): Promise<PermissionState>
  /** Every copy in the `_backups` folder, newest first. Rejects when the folder cannot be read. */
  listBackups(): Promise<BackupEntry[]>
  /** Copies the current file aside, then replaces it with the backup and tells subscribers. */
  restoreBackup(entry: BackupEntry): Promise<void>
  /**
   * Ends the hold on a JSON file that could not be parsed. The unreadable bytes are kept in a `.corrupt-` copy
   * first. `restore-latest` writes the newest valid backup and resolves with it; `start-fresh` writes the
   * edit that was held (if any) and resolves `null`. Rejects with the file untouched when a step fails.
   */
  resolveCorrupt(path: string, action: CorruptAction): Promise<BackupEntry | null>
  /**
   * Compares the files this tab has loaded with the disk and flags any that changed or vanished outside the
   * tab. Skips content reads unless only the modified time differs. Never rejects for a single unreadable file.
   */
  checkExternalChanges(): Promise<void>
  /**
   * Discards this tab's version of every externally changed file and lets subscribers re-read the disk. Any
   * edit that was waiting to be saved is kept as an `-unsaved` copy first; rejects with nothing changed if
   * that copy cannot be made.
   */
  reloadFromDisk(): Promise<void>
  /**
   * Overwrites every externally changed file with this tab's version (the held edit, or what the tab has
   * loaded). The disk version is copied to `_backups/` first and the file is left alone if that fails.
   */
  keepLocal(): Promise<void>
}

export const isSafetyNetStore = (store: FileStore): store is FileStore & SafetyNetStore => 'getSafetySnapshot' in store
