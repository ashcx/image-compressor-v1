import type { Dimensions } from './dimensions'

type MetadataResponse =
  | { type: 'dimensions'; jobId: string; width: number; height: number }
  | { type: 'thumbnail'; jobId: string; thumbnailBlob: Blob | null }

let worker: Worker | null = null
let counter = 0
const pendingDimensions = new Map<
  string,
  (dimensions: Dimensions | null) => void
>()
const pendingThumbnails = new Map<string, (blob: Blob | null) => void>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../workers/metadata-worker.ts', import.meta.url),
      { type: 'module' },
    )
    worker.onmessage = (event: MessageEvent<MetadataResponse>) => {
      const data = event.data
      if (data.type === 'thumbnail') {
        const resolve = pendingThumbnails.get(data.jobId)
        if (!resolve) return
        pendingThumbnails.delete(data.jobId)
        resolve(data.thumbnailBlob)
        return
      }
      const resolve = pendingDimensions.get(data.jobId)
      if (!resolve) return
      pendingDimensions.delete(data.jobId)
      const { width, height } = data
      resolve(width > 0 && height > 0 ? { width, height } : null)
    }
    worker.onerror = () => {
      for (const resolve of pendingDimensions.values()) resolve(null)
      pendingDimensions.clear()
      for (const resolve of pendingThumbnails.values()) resolve(null)
      pendingThumbnails.clear()
      worker?.terminate()
      worker = null
    }
  }
  return worker
}

/**
 * Terminates the metadata worker when the app is idle. Dimensions for later
 * files recreate it on demand. Skipped while a preview is in flight so an
 * in-progress thumbnail is not dropped.
 */
export function disposeMetadataWorker(): void {
  if (!worker) return
  if (pendingThumbnails.size > 0) return
  const active = worker
  worker = null
  active.terminate()
  for (const resolve of pendingDimensions.values()) resolve(null)
  pendingDimensions.clear()
}

/**
 * Reads the header dimensions for a file on a dedicated worker, separate from
 * the codec pool so it never contends with size estimation or compression.
 * Resolves `null` when the format cannot be parsed without decoding.
 */
export function readDimensions(file: File): Promise<Dimensions | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(null)

  const jobId = `meta-${++counter}`
  return new Promise((resolve) => {
    pendingDimensions.set(jobId, resolve)
    getWorker().postMessage({ type: 'dimensions', jobId, file })
  })
}

/**
 * Generates a fixed small JPEG preview from the source file on the metadata
 * worker. It intentionally accepts no target format: previews are independent
 * of the selected destination and are used lazily for visible rows. Resolves
 * `null` when the source cannot be decoded.
 */
export function readThumbnail(file: File): Promise<Blob | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(null)

  const jobId = `thumb-${++counter}`
  return new Promise((resolve) => {
    pendingThumbnails.set(jobId, resolve)
    getWorker().postMessage({ type: 'thumbnail', jobId, file })
  })
}

/**
 * Cancels thumbnail work before compression starts. Terminating the metadata
 * worker is intentional: an in-flight decode must not continue consuming CPU
 * while the codec pool is compressing the batch. Missing previews are retried
 * after compression resumes.
 */
export function cancelThumbnailRequests(): void {
  if (pendingThumbnails.size === 0) return

  const active = worker
  worker = null
  active?.terminate()

  for (const resolve of pendingThumbnails.values()) resolve(null)
  pendingThumbnails.clear()

  // The metadata worker also serves dimension reads. Resolve any that shared
  // the terminated worker so they cannot leave callers waiting forever.
  for (const resolve of pendingDimensions.values()) resolve(null)
  pendingDimensions.clear()
}
