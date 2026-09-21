export interface ZipStore {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<Blob>
  /** Discards a partially written archive without committing it. */
  abort(): Promise<void>
}

// Timestamped per app session so two tabs never share the same OPFS file.
export const ZIP_FILE_PREFIX = 'image-compressor-'
const ZIP_FILE_NAME = `${ZIP_FILE_PREFIX}${Date.now().toString(36)}.zip`
export const STALE_ZIP_MS = 24 * 60 * 60 * 1000

function zipTimestamp(name: string): number | null {
  if (!name.startsWith(ZIP_FILE_PREFIX) || !name.endsWith('.zip')) return null
  const stamp = Number.parseInt(
    name.slice(ZIP_FILE_PREFIX.length, -'.zip'.length),
    36,
  )
  return Number.isFinite(stamp) ? stamp : null
}

/**
 * Best-effort removal of zip scratch files abandoned by earlier sessions (for
 * example a crashed tab). The current session's file is left alone.
 */
async function removeStaleZipFiles(
  root: FileSystemDirectoryHandle,
  current: string,
): Promise<void> {
  const now = Date.now()
  try {
    for await (const [name, handle] of root.entries()) {
      if (name === current || handle.kind !== 'file') continue
      const created = zipTimestamp(name)
      if (created === null || now - created < STALE_ZIP_MS) continue
      try {
        await root.removeEntry(name)
      } catch {
        // Another tab may still be writing it; leave it alone.
      }
    }
  } catch {
    // Iteration can fail on exotic OPFS implementations; nothing to sweep.
  }
}

async function createMemoryStore(): Promise<ZipStore> {
  const parts: Uint8Array[] = []
  return {
    async write(chunk) {
      parts.push(chunk)
    },
    async close() {
      return new Blob(parts as BlobPart[], { type: 'application/zip' })
    },
    async abort() {
      parts.length = 0
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
      void removeStaleZipFiles(root, ZIP_FILE_NAME)
      const handle = await root.getFileHandle(ZIP_FILE_NAME, {
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
        async abort() {
          if (closed) return
          closed = true
          try {
            await writable.abort()
          } catch {
            // The stream may already be errored; removal below still applies.
          }
          try {
            await root.removeEntry(ZIP_FILE_NAME)
          } catch {
            // Nothing to remove.
          }
        },
      }
    } catch {
      // Permission/quota failure: fall back to memory.
    }
  }
  return createMemoryStore()
}

/** Removes the temporary zip file left in OPFS, if any. */
export async function resetZipStore(): Promise<void> {
  if (!hasOpfs()) return
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(ZIP_FILE_NAME)
  } catch {
    // Nothing to remove, or OPFS is unavailable.
  }
}
