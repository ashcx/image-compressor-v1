import type { Dimensions } from './dimensions'

interface MetadataResponse {
  type: 'dimensions'
  jobId: string
  width: number
  height: number
}

let worker: Worker | null = null
let counter = 0
const pending = new Map<string, (dimensions: Dimensions | null) => void>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../workers/metadata-worker.ts', import.meta.url),
      { type: 'module' },
    )
    worker.onmessage = (event: MessageEvent<MetadataResponse>) => {
      const resolve = pending.get(event.data.jobId)
      if (!resolve) return
      pending.delete(event.data.jobId)
      const { width, height } = event.data
      resolve(width > 0 && height > 0 ? { width, height } : null)
    }
    worker.onerror = () => {
      for (const resolve of pending.values()) resolve(null)
      pending.clear()
      worker?.terminate()
      worker = null
    }
  }
  return worker
}

/**
 * Terminates the metadata worker when the app is idle. Dimensions for later
 * files recreate it on demand.
 */
export function disposeMetadataWorker(): void {
  if (!worker) return
  const active = worker
  worker = null
  active.terminate()
  for (const resolve of pending.values()) resolve(null)
  pending.clear()
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
    pending.set(jobId, resolve)
    getWorker().postMessage({ type: 'dimensions', jobId, file })
  })
}
