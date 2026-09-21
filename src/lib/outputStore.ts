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
 * they can be read back on demand and deleted when a job is removed. The memory
 * fallback reports its retained bytes and whether it is over the configured
 * budget so the app can stop starting new work instead of growing without
 * bound.
 */
export interface OutputStore {
  /** True when outputs are held outside JS memory (OPFS). */
  readonly persistent: boolean
  /** Bytes currently retained in JS memory (fallback or failed OPFS writes). */
  readonly memoryBytes: number
  /** True when retained memory bytes exceed the configured budget. */
  readonly overBudget: boolean
  put(id: string, blob: Blob): Promise<void>
  get(id: string): Promise<Blob | null>
  delete(id: string): Promise<void>
  clear(): Promise<void>
}

export interface OutputStoreOptions {
  /** Memory ceiling for non-persistent (or fallback) blobs, in bytes. */
  maxMemoryBytes?: number
}

export const SESSION_PREFIX = 'image-compressor-outputs-'
export const STALE_SESSION_MS = 24 * 60 * 60 * 1000

function fileNames(id: string): string {
  return `${encodeURIComponent(id)}.bin`
}

/** In-memory fallback. Bounded by `maxBytes` and cleared with the queue. */
export function createMemoryOutputStore(
  maxBytes = Number.POSITIVE_INFINITY,
): OutputStore {
  const files = new Map<string, Blob>()
  let bytes = 0
  return {
    persistent: false,
    get memoryBytes() {
      return bytes
    },
    get overBudget() {
      return bytes > maxBytes
    },
    async put(id, blob) {
      const previous = files.get(id)
      if (previous) bytes -= previous.size
      files.set(id, blob)
      bytes += blob.size
    },
    async get(id) {
      return files.get(id) ?? null
    },
    async delete(id) {
      const previous = files.get(id)
      if (!previous) return
      bytes -= previous.size
      files.delete(id)
    },
    async clear() {
      files.clear()
      bytes = 0
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

async function createOpfsStore(maxBytes: number): Promise<OutputStore | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return null
  }
  try {
    const root = await navigator.storage.getDirectory()
    const name = `${SESSION_PREFIX}${Date.now().toString(36)}`
    const directory = await root.getDirectoryHandle(name, { create: true })
    // Quota or write failures degrade to memory instead of failing the job.
    const fallback = new Map<string, Blob>()
    let fallbackBytes = 0

    void removeStaleSessions(root, name)

    const forgetFallback = (id: string) => {
      const previous = fallback.get(id)
      if (!previous) return
      fallbackBytes -= previous.size
      fallback.delete(id)
    }
    const rememberFallback = (id: string, blob: Blob) => {
      forgetFallback(id)
      fallback.set(id, blob)
      fallbackBytes += blob.size
    }

    return {
      persistent: true,
      get memoryBytes() {
        return fallbackBytes
      },
      get overBudget() {
        return fallbackBytes > maxBytes
      },
      async put(id, blob) {
        try {
          const handle = await directory.getFileHandle(fileNames(id), {
            create: true,
          })
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
          forgetFallback(id)
        } catch {
          rememberFallback(id, blob)
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
        forgetFallback(id)
        try {
          await directory.removeEntry(fileNames(id))
        } catch {
          // Already gone.
        }
      },
      async clear() {
        fallback.clear()
        fallbackBytes = 0
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

/** OPFS when available, otherwise a bounded memory fallback. */
export async function createOutputStore(
  options: OutputStoreOptions = {},
): Promise<OutputStore> {
  const maxBytes = options.maxMemoryBytes ?? Number.POSITIVE_INFINITY
  return (await createOpfsStore(maxBytes)) ?? createMemoryOutputStore(maxBytes)
}
