interface Entry {
  file: File
  /** Reserved read size, used before the buffer exists. */
  size: number
  buffer?: ArrayBuffer
  error?: Error
  promise?: Promise<void>
  eager: boolean
  token: number
}

// Source bytes are read eagerly, while the `File` handle handed over by the
// picker/drop is still guaranteed valid, and cached per job. Deferring the read
// until a worker was free (the previous behaviour) failed with NotFoundError
// whenever the backing file was moved, deleted, or was a transient drag-and-drop
// temp file. Reads are budgeted so a huge batch cannot balloon the heap.
const DEFAULT_CAP = 320 * 1024 * 1024
let byteCap = DEFAULT_CAP

function defaultReadConcurrency(): number {
  if (typeof navigator === 'undefined') return 4
  return Math.min(4, Math.max(2, navigator.hardwareConcurrency || 4))
}

let readConcurrency = defaultReadConcurrency()

const entries = new Map<string, Entry>()
let bufferedBytes = 0
// Bytes claimed by in-flight reads that have not produced a buffer yet.
let reservedBytes = 0
let reading = 0
let readSeq = 0
let scheduled = false

function pump(): void {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    while (reading < readConcurrency) {
      const next = findUnread()
      if (!next) return
      startRead(next)
    }
  })
}

/** Only eager reads that fit the remaining budget are started. */
function findUnread(): Entry | undefined {
  for (const entry of entries.values()) {
    if (!entry.eager || entry.buffer || entry.promise || entry.error) continue
    if (bufferedBytes + reservedBytes + entry.size > byteCap) continue
    return entry
  }
  return undefined
}

function startRead(entry: Entry): void {
  const token = ++readSeq
  const size = entry.size
  entry.token = token
  reading += 1
  reservedBytes += size
  entry.promise = (async () => {
    try {
      const buffer = await entry.file.arrayBuffer()
      if (entry.token !== token) return
      entry.buffer = buffer
      bufferedBytes += buffer.byteLength
    } catch (cause) {
      if (entry.token === token) {
        entry.error =
          cause instanceof Error ? cause : new Error('Could not read the file')
      }
    } finally {
      reading -= 1
      reservedBytes -= size
      if (entry.token === token) entry.promise = undefined
      pump()
    }
  })()
}

function resolveBuffer(entry: Entry, id: string): Promise<ArrayBuffer> {
  if (entry.buffer) return Promise.resolve(entry.buffer)
  if (entry.error) return Promise.reject(entry.error)
  if (entry.promise) {
    return entry.promise.then(() => {
      if (entry.buffer) return entry.buffer
      throw entry.error ?? new Error(`Could not read "${id}"`)
    })
  }
  startRead(entry)
  return resolveBuffer(entry, id)
}

function readSize(file: File): number {
  return typeof file.size === 'number' && Number.isFinite(file.size)
    ? file.size
    : 0
}

/** Registers a job's file for eager reading. */
export function registerFile(id: string, file: File): void {
  if (entries.has(id)) return
  entries.set(id, { file, size: readSize(file), eager: true, token: 0 })
  pump()
}

/**
 * Resolves the source bytes for a job. Starts a read on demand if the eager
 * read had not run yet (e.g. the batch exceeded the memory cap) or its buffer
 * was released. With `consume`, ownership is handed to the caller (the buffer
 * will be transferred) and the cached bytes are dropped.
 */
export function acquireFileBuffer(
  id: string,
  consume = false,
): Promise<ArrayBuffer> {
  const entry = entries.get(id)
  if (!entry) {
    return Promise.reject(new Error('The file is no longer available'))
  }
  const buffer = resolveBuffer(entry, id)
  if (!consume) return buffer
  return buffer.then((data) => {
    releaseFileBuffer(id)
    return data
  })
}

/**
 * Frees a job's cached bytes after compression while keeping the `File` handle
 * so changing settings can read (and re-read) it on demand. Eager reading is
 * disabled for the entry so released memory is not immediately reclaimed.
 */
export function releaseFileBuffer(id: string): void {
  const entry = entries.get(id)
  if (!entry) return
  if (entry.buffer) bufferedBytes -= entry.buffer.byteLength
  entry.buffer = undefined
  entry.error = undefined
  entry.eager = false
  entry.token = ++readSeq
}

/** Drops a job's file entirely (removed or cleared). */
export function forgetFile(id: string): void {
  const entry = entries.get(id)
  if (!entry) return
  if (entry.buffer) bufferedBytes -= entry.buffer.byteLength
  entry.token = ++readSeq
  entries.delete(id)
  pump()
}

/** Sets the read-ahead byte cap, e.g. from the device's memory budget. */
export function configureFileBufferCap(bytes: number): void {
  byteCap = Math.max(16 * 1024 * 1024, bytes)
  pump()
}

/**
 * Sets read-ahead concurrency independently of the codec worker budget, so
 * memory-constrained devices can read fewer files at once.
 */
export function configureFileReadConcurrency(count: number): void {
  readConcurrency = Math.max(1, Math.floor(count))
  pump()
}

/** Test seam: overrides the read-ahead byte cap. */
export function setFileBufferCapForTests(bytes: number): void {
  byteCap = bytes
  pump()
}

/** Test seam: restores the default read concurrency. */
export function resetFileReadConcurrencyForTests(): void {
  readConcurrency = defaultReadConcurrency()
  pump()
}
