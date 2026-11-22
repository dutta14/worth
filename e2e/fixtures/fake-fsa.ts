import type { Page } from '@playwright/test'

/**
 * In-page fake File System Access API (`showDirectoryPicker` plus directory and
 * file handles) so e2e tests can drive the real `FileSystemFileStore`, which the
 * shared fixture bypasses by forcing `_e2eMode` and a `MemoryFileStore`.
 *
 * Controls live on `window.__fakeFsa` and are reachable from `page.evaluate`.
 * The fake stays minimal on purpose: it models only what the store calls.
 */

export interface FakeFsaControls {
  /** Flat map of relative path to text content. Directories are implied by their files. */
  files: Map<string, string>
  /** Modified time per path in ms; paths without one report `DEFAULT_MTIME`. Every commit takes the next `clock` tick. */
  mtimes: Map<string, number>
  /** Last modified time handed out; external edits made through `changeOnDisk` take the next tick too. */
  clock: number
  /** Extra empty directories created through `getDirectoryHandle({ create: true })`. */
  dirs: Set<string>
  /** Permission state reported by `queryPermission` and enforced on reads and writes. */
  permission: PermissionState
  /** What `requestPermission` answers; a grant also flips `permission` to `granted`. */
  grantOnRequest: boolean
  /** Number of upcoming `close()` calls that reject; counts down, `0` disables the fault. */
  failCloseTimes: number
  /** `DOMException` name thrown by the injected `close()` failure. */
  failCloseName: string
  /** Only inject close failures for this path; every path when empty. */
  failClosePath: string
  /** Milliseconds each `close()` waits before committing, to keep a write in flight. */
  closeDelayMs: number
  /** Successful commits in order, for asserting what reached the "disk". */
  commits: { path: string; content: string }[]
  /** Calls to `requestPermission`. */
  requestPermissionCalls: number
  /** Calls to `queryPermission`. */
  queryPermissionCalls: number
}

declare global {
  interface Window {
    __fakeFsa?: FakeFsaControls
  }
}

function fakeFsaInitScript(seed: Record<string, string>): void {
  const state: FakeFsaControls = {
    files: new Map(Object.entries(seed)),
    mtimes: new Map<string, number>(),
    clock: 1_700_000_000_000,
    dirs: new Set<string>(),
    permission: 'granted',
    grantOnRequest: true,
    failCloseTimes: 0,
    failCloseName: 'InvalidStateError',
    failClosePath: '',
    closeDelayMs: 0,
    commits: [],
    requestPermissionCalls: 0,
    queryPermissionCalls: 0,
  }
  window.__fakeFsa = state

  const DEFAULT_MTIME = 1_700_000_000_000
  const fault = (name: string): DOMException => new DOMException(`fake fsa: ${name}`, name)
  const assertAccess = (): void => {
    if (state.permission !== 'granted') throw fault('NotAllowedError')
  }
  const join = (prefix: string, name: string): string => (prefix ? `${prefix}/${name}` : name)
  const dirExists = (prefix: string): boolean =>
    prefix === '' ||
    state.dirs.has(prefix) ||
    [...state.files.keys()].some(path => path.startsWith(`${prefix}/`)) ||
    [...state.dirs].some(dir => dir.startsWith(`${prefix}/`))

  class FakeFileHandle {
    readonly kind = 'file' as const
    constructor(
      readonly name: string,
      private readonly path: string,
    ) {}

    async getFile(): Promise<File> {
      assertAccess()
      const content = state.files.get(this.path)
      if (content === undefined) throw fault('NotFoundError')
      return new File([content], this.name, {
        lastModified: state.mtimes.get(this.path) ?? DEFAULT_MTIME,
      })
    }

    async createWritable() {
      assertAccess()
      const path = this.path
      let buffer = ''
      return {
        async write(data: string | Blob): Promise<void> {
          buffer = typeof data === 'string' ? data : await data.text()
        },
        async close(): Promise<void> {
          if (state.closeDelayMs > 0) await new Promise(resolve => setTimeout(resolve, state.closeDelayMs))
          assertAccess()
          const matches = state.failClosePath === '' || state.failClosePath === path
          if (state.failCloseTimes > 0 && matches) {
            state.failCloseTimes -= 1
            throw fault(state.failCloseName)
          }
          state.files.set(path, buffer)
          state.clock += 1000
          state.mtimes.set(path, state.clock)
          state.commits.push({ path, content: buffer })
        },
      }
    }
  }

  class FakeDirectoryHandle {
    readonly kind = 'directory' as const
    constructor(
      readonly name: string,
      private readonly prefix: string,
    ) {}

    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectoryHandle> {
      assertAccess()
      const path = join(this.prefix, name)
      if (!dirExists(path)) {
        if (!options?.create) throw fault('NotFoundError')
        state.dirs.add(path)
      }
      return new FakeDirectoryHandle(name, path)
    }

    async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
      assertAccess()
      const path = join(this.prefix, name)
      if (!state.files.has(path)) {
        if (!options?.create) throw fault('NotFoundError')
        state.files.set(path, '')
      }
      return new FakeFileHandle(name, path)
    }

    async removeEntry(name: string): Promise<void> {
      assertAccess()
      if (!state.files.delete(join(this.prefix, name))) throw fault('NotFoundError')
    }

    async *values(): AsyncGenerator<FakeFileHandle | FakeDirectoryHandle> {
      assertAccess()
      const base = this.prefix ? `${this.prefix}/` : ''
      const seen = new Set<string>()
      const paths = [...state.files.keys(), ...state.dirs]
      for (const path of paths) {
        if (!path.startsWith(base)) continue
        const [head, ...rest] = path.slice(base.length).split('/')
        if (!head || seen.has(head)) continue
        seen.add(head)
        const childPath = join(this.prefix, head)
        yield rest.length > 0 || state.dirs.has(childPath)
          ? new FakeDirectoryHandle(head, childPath)
          : new FakeFileHandle(head, childPath)
      }
    }

    async queryPermission(): Promise<PermissionState> {
      state.queryPermissionCalls += 1
      return state.permission
    }

    async requestPermission(): Promise<PermissionState> {
      state.requestPermissionCalls += 1
      if (state.grantOnRequest) state.permission = 'granted'
      return state.grantOnRequest ? 'granted' : 'denied'
    }
  }

  const root = new FakeDirectoryHandle('fake-folder', '')
  ;(window as Window & { showDirectoryPicker?: () => Promise<unknown> }).showDirectoryPicker = async () => root
}

/** Installs the fake before any page script runs. `seed` maps relative paths to text content. */
export async function installFakeFsa(page: Page, seed: Record<string, string> = {}): Promise<void> {
  await page.addInitScript(fakeFsaInitScript, seed)
}

/** Edits a file the way another machine or a sync tool would: new content and a new modified time. */
export async function changeOnDisk(page: Page, path: string, content: string): Promise<void> {
  await page.evaluate(
    ({ target, next }) => {
      const state = window.__fakeFsa as FakeFsaControls
      state.clock += 1000
      state.files.set(target, next)
      state.mtimes.set(target, state.clock)
    },
    { target: path, next: content },
  )
}

/** Moves a file's modified time without touching its content, like a sync client re-stamping it. */
export async function touchOnDisk(page: Page, path: string): Promise<void> {
  await page.evaluate(target => {
    const state = window.__fakeFsa as FakeFsaControls
    state.clock += 1000
    state.mtimes.set(target, state.clock)
  }, path)
}

/** Removes a file the way another machine would. */
export async function removeOnDisk(page: Page, path: string): Promise<void> {
  await page.evaluate(target => {
    ;(window.__fakeFsa as FakeFsaControls).files.delete(target)
  }, path)
}
