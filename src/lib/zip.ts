import { Zip, ZipPassThrough } from 'fflate'
import { createZipStore } from './zipStore'

export class ZipTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Zip exceeds the ${Math.round(maxBytes / 1048576)} MB limit`)
    this.name = 'ZipTooLargeError'
  }
}

export interface StreamingZip {
  readonly size: number
  add(name: string, data: Uint8Array | Blob): Promise<void>
  finish(): Promise<Blob>
}

/**
 * Returns a name that is not already in `used`, appending `-2`, `-3`, … before
 * the extension on collision, and records it. Keeps batches whose inputs share a
 * filename (e.g. photo.jpg from two folders) from overwriting each other.
 */
export function uniqueEntryName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name)
    return name
  }

  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''

  let index = 2
  let candidate = `${base}-${index}${extension}`
  while (used.has(candidate)) {
    index += 1
    candidate = `${base}-${index}${extension}`
  }
  used.add(candidate)
  return candidate
}

/**
 * Builds a zip incrementally, writing each entry to storage as it is added so
 * the whole archive is never held in JS memory. Entries are stored (not
 * deflated) because images are already compressed.
 */
export async function createStreamingZip(
  maxBytes: number,
): Promise<StreamingZip> {
  const store = await createZipStore()
  let pending: Uint8Array[] = []
  let size = 0
  let streamError: Error | null = null

  const zip = new Zip((error, chunk) => {
    if (error) {
      streamError = error
      return
    }
    pending.push(chunk)
  })

  const flush = async () => {
    if (streamError) throw streamError
    const chunks = pending
    pending = []
    for (const chunk of chunks) {
      await store.write(chunk)
      size += chunk.byteLength
    }
  }

  const pushEntry = async (entry: ZipPassThrough, data: Uint8Array | Blob) => {
    if (data instanceof Blob) {
      const reader = data.stream().getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          entry.push(value, false)
          await flush()
        }
      } finally {
        reader.releaseLock()
      }
      entry.push(new Uint8Array(0), true)
    } else {
      entry.push(data, true)
    }
    await flush()
    if (size > maxBytes) throw new ZipTooLargeError(maxBytes)
  }

  return {
    get size() {
      return size
    },
    async add(name, data) {
      if (streamError) throw streamError
      const entry = new ZipPassThrough(name)
      zip.add(entry)
      await pushEntry(entry, data)
    },
    async finish() {
      zip.end()
      await flush()
      return store.close()
    },
  }
}
