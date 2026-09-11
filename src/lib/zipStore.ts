export interface ZipStore {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<Blob>
}

export async function createMemoryStore(): Promise<ZipStore> {
  const parts: Uint8Array[] = []
  return {
    async write(chunk) {
      parts.push(chunk)
    },
    async close() {
      return new Blob(parts as BlobPart[], { type: 'application/zip' })
    },
  }
}

function hasOpfs(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  )
}

/**
 * Streams zip output to the origin private file system when available so the
 * tab does not hold the whole archive in JS memory. Falls back to an in-memory
 * blob for browsers without OPFS.
 */
export async function createZipStore(): Promise<ZipStore> {
  if (hasOpfs()) {
    try {
      const root = await navigator.storage.getDirectory()
      const handle = await root.getFileHandle('image-compressor.zip', {
        create: true,
      })
      const writable = await handle.createWritable()
      let closed = false
      return {
        async write(chunk) {
          if (closed) throw new Error('Zip store is closed')
          await writable.write(chunk as unknown as BufferSource)
        },
        async close() {
          if (!closed) {
            closed = true
            await writable.close()
          }
          return handle.getFile()
        },
      }
    } catch {
      // Permission/quota failure: fall back to memory.
    }
  }
  return createMemoryStore()
}
