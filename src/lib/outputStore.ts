/**
 * Storage for completed output blobs.
 *
 * The queue used to hold every finished full-resolution Blob in JavaScript
 * memory until the user cleared it, so repeated batches in one tab grew memory
 * without bound (the JS heap stayed flat, but the Blob/array-buffer backing
 * store did not). This store moves outputs out of the live set: the Origin
 * Private File System when available, otherwise a bounded in-memory fallback.
 *
 * Outputs are written per app session and are only needed for downloads, so
 * they can be read back on demand and deleted when a job is removed.
 */
export interface OutputStore {
  /** True when outputs are held outside JS memory (OPFS). */
  readonly persistent: boolean
  put(id: string, blob: Blob): Promise<void>
  get(id: string): Promise<Blob | null>
  delete(id: string): Promise<void>
  clear(): Promise<void>
}

const SESSION_PREFIX = 'image-compressor-outputs-'
const STALE_SESSION_MS = 24 * 60 * 60 * 1000

function fileNames(id: string): string {
  return `${encodeURIComponent(id)}.bin`
}

/** In-memory fallback. Bounded only by the caller clearing the queue. */
export function createMemoryOutputStore(): OutputStore {
  const files = new Map<string, Blob>()
  return {
    persistent: false,
    async put(id, blob) {
      files.set(id, blob)
    },
    async get(id) {
      return files.get(id) ?? null
    },
    async delete(id) {
      files.delete(id)
    },
    async clear() {
      files.clear()
    },
  }
}

function sessionTimestamp(name: string): number | null {
  if (!name.startsWith(SESSION_PREFIX)) return null
  const stamp = Number.parseInt(name.slice(SESSION_PREFIX.length), 36)
  return Number.isFinite(stamp) ? stamp : null
}

/** Best-effort removal of output directories abandoned by earlier sessions. */
async function removeStaleSessions(
  root: FileSystemDirectoryHandle,
  current: string,
): Promise<void> {
  const now = Date.now()
  for await (const [name, handle] of root.entries()) {
    if (name === current || handle.kind !== 'directory') continue
    const created = sessionTimestamp(name)
    if (created === null || now - created < STALE_SESSION_MS) continue
    try {
      await root.removeEntry(name, { recursive: true })
    } catch {
      // Another tab may be using it; leave it alone.
    }
  }
}

async function createOpfsStore(): Promise<OutputStore | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return null
  }
  try {
    const root = await navigator.storage.getDirectory()
    const name = `${SESSION_PREFIX}${Date.now().toString(36)}`
    const directory = await root.getDirectoryHandle(name, { create: true })
    // Quota or write failures degrade to memory instead of failing the job.
    const fallback = new Map<string, Blob>()

    void removeStaleSessions(root, name)

    return {
      persistent: true,
      async put(id, blob) {
        try {
          const handle = await directory.getFileHandle(fileNames(id), {
            create: true,
          })
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
          fallback.delete(id)
        } catch {
          fallback.set(id, blob)
        }
      },
      async get(id) {
        const cached = fallback.get(id)
        if (cached) return cached
        try {
          const handle = await directory.getFileHandle(fileNames(id))
          const file = await handle.getFile()
          return file.size > 0 ? file : null
        } catch {
          return null
        }
      },
      async delete(id) {
        fallback.delete(id)
        try {
          await directory.removeEntry(fileNames(id))
        } catch {
          // Already gone.
        }
      },
      async clear() {
        fallback.clear()
        for await (const [entry] of directory.entries()) {
          try {
            await directory.removeEntry(entry)
          } catch {
            // Already gone.
          }
        }
      },
    }
  } catch {
    return null
  }
}

/** OPFS when available, otherwise a memory fallback. */
export async function createOutputStore(): Promise<OutputStore> {
  return (await createOpfsStore()) ?? createMemoryOutputStore()
}
