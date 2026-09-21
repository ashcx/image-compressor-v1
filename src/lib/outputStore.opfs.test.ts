import { afterEach, describe, expect, it } from 'vitest'
import {
  createOutputStore,
  SESSION_PREFIX,
  STALE_SESSION_MS,
} from './outputStore'

/**
 * Minimal in-memory stand-in for the Origin Private File System, enough for the
 * output store: directory/file handles, async entry iteration, and a writable
 * that can simulate a quota failure.
 */
class FakeDir {
  readonly files = new Map<string, Blob>()
  readonly dirs = new Map<string, FakeDir>()

  constructor(readonly state: { failWrites: boolean }) {}

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FakeDir> {
    const existing = this.dirs.get(name)
    if (existing) return existing
    if (!options?.create) throw new DOMException('NotFoundError')
    const dir = new FakeDir(this.state)
    this.dirs.set(name, dir)
    return dir
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException('NotFoundError')
      this.files.set(name, new Blob([]))
    }
    const state = this.state
    const files = this.files
    return {
      async createWritable() {
        const chunks: BlobPart[] = []
        return {
          async write(chunk: BlobPart) {
            if (state.failWrites) throw new DOMException('QuotaExceededError')
            chunks.push(chunk)
          },
          async close() {
            if (state.failWrites) throw new DOMException('QuotaExceededError')
            files.set(name, new Blob(chunks))
          },
        }
      },
      async getFile() {
        return files.get(name) ?? new Blob([])
      },
    }
  }

  async removeEntry(name: string, options?: { recursive?: boolean }) {
    if (this.files.delete(name)) return
    const dir = this.dirs.get(name)
    if (
      dir &&
      (options?.recursive || (dir.files.size === 0 && dir.dirs.size === 0))
    ) {
      this.dirs.delete(name)
      return
    }
    throw new DOMException('NotFoundError')
  }

  async *entries(): AsyncGenerator<[string, { kind: 'file' | 'directory' }]> {
    for (const name of this.files.keys()) yield [name, { kind: 'file' }]
    for (const name of this.dirs.keys()) yield [name, { kind: 'directory' }]
  }
}

const originalNavigator = globalThis.navigator

function installOpfs(root: FakeDir): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      storage: { getDirectory: async () => root },
    } as unknown as Navigator,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
    writable: true,
  })
})

describe('OPFS output store', () => {
  it('persists outputs to the file system', async () => {
    const root = new FakeDir({ failWrites: false })
    installOpfs(root)
    const store = await createOutputStore()
    expect(store.persistent).toBe(true)

    await store.put('a', new Blob(['hello']))
    expect(store.memoryBytes).toBe(0)
    expect(await (await store.get('a'))?.text()).toBe('hello')

    await store.delete('a')
    expect(await store.get('a')).toBeNull()
  })

  it('falls back to memory and flags over-budget on quota failure', async () => {
    const root = new FakeDir({ failWrites: true })
    installOpfs(root)
    const store = await createOutputStore({ maxMemoryBytes: 10 })

    await store.put('a', new Blob(['hello']))
    expect(store.memoryBytes).toBe(5)
    expect(store.overBudget).toBe(false)

    await store.put('b', new Blob(['world!']))
    expect(store.memoryBytes).toBe(11)
    expect(store.overBudget).toBe(true)
    // Fallback blobs must still be readable.
    expect(await (await store.get('a'))?.text()).toBe('hello')

    await store.clear()
    expect(store.memoryBytes).toBe(0)
    expect(store.overBudget).toBe(false)
  })

  it('removes abandoned session directories on startup', async () => {
    const root = new FakeDir({ failWrites: false })
    const stale = `${SESSION_PREFIX}${(Date.now() - 2 * STALE_SESSION_MS).toString(36)}`
    const fresh = `${SESSION_PREFIX}${Date.now().toString(36)}`
    root.dirs.set(stale, new FakeDir(root.state))
    root.dirs.set(fresh, new FakeDir(root.state))
    root.dirs.set('unrelated', new FakeDir(root.state))
    installOpfs(root)

    await createOutputStore()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.dirs.has(stale)).toBe(false)
    expect(root.dirs.has(fresh)).toBe(true)
    expect(root.dirs.has('unrelated')).toBe(true)
  })
})

describe('session scoping', () => {
  it('clears only the current session directory', async () => {
    const root = new FakeDir({ failWrites: false })
    const other = new FakeDir(root.state)
    other.files.set('keep.bin', new Blob(['keep']))
    root.dirs.set(`${SESSION_PREFIX}other`, other)
    installOpfs(root)

    const store = await createOutputStore()
    await store.put('a', new Blob(['hello']))
    expect(await (await store.get('a'))?.text()).toBe('hello')

    await store.clear()

    expect(await store.get('a')).toBeNull()
    expect(other.files.has('keep.bin')).toBe(true)
  })
})
