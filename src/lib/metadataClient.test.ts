import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelThumbnailRequests,
  disposeMetadataWorker,
  readThumbnail,
} from './metadataClient'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(): void {}

  terminate(): void {
    this.terminated = true
  }
}

afterEach(() => {
  cancelThumbnailRequests()
  disposeMetadataWorker()
  FakeWorker.instances = []
  vi.unstubAllGlobals()
})

describe('metadata thumbnail cancellation', () => {
  it('terminates in-flight preview work and resolves it as missing', async () => {
    vi.stubGlobal('Worker', FakeWorker)

    const pending = readThumbnail(new Blob() as File)
    const worker = FakeWorker.instances[0]

    cancelThumbnailRequests()

    await expect(pending).resolves.toBeNull()
    expect(worker.terminated).toBe(true)
  })

  it('allows missing previews to be retried on a fresh worker', async () => {
    vi.stubGlobal('Worker', FakeWorker)

    const first = readThumbnail(new Blob() as File)
    cancelThumbnailRequests()
    await expect(first).resolves.toBeNull()

    const second = readThumbnail(new Blob() as File)
    expect(FakeWorker.instances).toHaveLength(2)

    cancelThumbnailRequests()
    await expect(second).resolves.toBeNull()
  })
})
