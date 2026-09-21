import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { createStreamingZip, uniqueEntryName, ZipTooLargeError } from './zip'
import {
  createZipStore,
  resetZipStore,
  STALE_ZIP_MS,
  ZIP_FILE_PREFIX,
} from './zipStore'

const originalNavigator = globalThis.navigator

function fakeOpfs(initial: Record<string, Blob>) {
  const files = new Map(Object.entries(initial))
  const root = {
    async getFileHandle(name: string) {
      return {
        async createWritable() {
          const chunks: BlobPart[] = []
          return {
            async write(chunk: BlobPart) {
              chunks.push(chunk)
            },
            async close() {
              files.set(name, new Blob(chunks))
            },
            async abort() {},
          }
        },
        async getFile() {
          return files.get(name) ?? new Blob([])
        },
      }
    },
    async removeEntry(name: string) {
      if (!files.delete(name)) throw new DOMException('NotFoundError')
    },
    async *entries(): AsyncGenerator<[string, { kind: 'file' }]> {
      for (const name of files.keys()) yield [name, { kind: 'file' }]
    },
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: { storage: { getDirectory: async () => root } },
    configurable: true,
    writable: true,
  })
  return { files }
}

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
    writable: true,
  })
})

describe('resetZipStore', () => {
  it('is a no-op without OPFS', async () => {
    await expect(resetZipStore()).resolves.toBeUndefined()
  })
})

describe('createZipStore stale scratch sweep', () => {
  it('removes abandoned zip files but keeps fresh and unrelated files', async () => {
    const stale = `${ZIP_FILE_PREFIX}${(Date.now() - 2 * STALE_ZIP_MS).toString(36)}.zip`
    const fresh = `${ZIP_FILE_PREFIX}${Date.now().toString(36)}.zip`
    const { files } = fakeOpfs({
      [stale]: new Blob(['stale']),
      [fresh]: new Blob(['fresh']),
      'unrelated.bin': new Blob(['keep']),
    })

    const store = await createZipStore()
    await store.write(new Uint8Array([1, 2, 3]))
    await store.close()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(files.has(stale)).toBe(false)
    expect(files.has(fresh)).toBe(true)
    expect(files.has('unrelated.bin')).toBe(true)
  })
})

describe('uniqueEntryName', () => {
  it('returns the original name when unused', () => {
    const used = new Set<string>()
    expect(uniqueEntryName('photo.jpg', used)).toBe('photo.jpg')
    expect(used.has('photo.jpg')).toBe(true)
  })

  it('appends an incrementing suffix on collision', () => {
    const used = new Set<string>()
    expect(uniqueEntryName('photo.jpg', used)).toBe('photo.jpg')
    expect(uniqueEntryName('photo.jpg', used)).toBe('photo-2.jpg')
    expect(uniqueEntryName('photo.jpg', used)).toBe('photo-3.jpg')
  })

  it('handles names without an extension', () => {
    const used = new Set(['clip'])
    expect(uniqueEntryName('clip', used)).toBe('clip-2')
  })
})

describe('createStreamingZip', () => {
  it('streams Uint8Array and Blob entries into a valid zip', async () => {
    const zip = await createStreamingZip(1024 * 1024)
    await zip.add('a.jpg', new Uint8Array([1, 2, 3]))
    await zip.add('b.png', new Blob([new Uint8Array([4, 5, 6])]))
    const blob = await zip.finish()

    const contents = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(contents).sort()).toEqual(['a.jpg', 'b.png'])
    expect(Array.from(contents['a.jpg'])).toEqual([1, 2, 3])
    expect(Array.from(contents['b.png'])).toEqual([4, 5, 6])
  })

  it('rejects an archive that exceeds the size limit', async () => {
    const zip = await createStreamingZip(4)
    await expect(
      zip.add('big.jpg', new Uint8Array(100)),
    ).rejects.toBeInstanceOf(ZipTooLargeError)
  })
})
