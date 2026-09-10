import { describe, expect, it } from 'vitest'
import type { ResultResponse, WorkerRequest, WorkerResponse } from './protocol'
import { type PoolTask, type PoolWorker, WorkerPool } from './workerPool'

function resultFor(jobId: string): ResultResponse {
  return {
    type: 'result',
    jobId,
    outputBuffer: new ArrayBuffer(1),
    outputSize: 1,
    width: 1,
    height: 1,
    format: 'webp',
    extension: 'webp',
    mimeType: 'image/webp',
  }
}

function task(jobId: string): PoolTask {
  return {
    jobId,
    message: {
      type: 'process',
      jobId,
      fileBuffer: new ArrayBuffer(1),
      targetFormat: 'webp',
    },
  }
}

class FakeWorker implements PoolWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly posted: WorkerRequest[] = []
  terminated = false

  constructor(
    private readonly onPost: (
      worker: FakeWorker,
      message: WorkerRequest,
    ) => void,
  ) {}

  postMessage(message: WorkerRequest): void {
    this.posted.push(message)
    this.onPost(this, message)
  }

  terminate(): void {
    this.terminated = true
  }

  respond(response: WorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>)
  }

  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent)
  }
}

describe('WorkerPool', () => {
  it('resolves a job with the worker result', async () => {
    const pool = new WorkerPool({
      size: 1,
      createWorker: () =>
        new FakeWorker((worker, message) =>
          worker.respond(resultFor(message.jobId)),
        ),
    })

    await expect(pool.run(task('a'))).resolves.toMatchObject({
      jobId: 'a',
      type: 'result',
    })
  })

  it('rejects a job error but keeps processing the next job', async () => {
    let count = 0
    const pool = new WorkerPool({
      size: 1,
      createWorker: () =>
        new FakeWorker((worker, message) => {
          count += 1
          if (count === 1) {
            worker.respond({
              type: 'error',
              jobId: message.jobId,
              error: 'bad file',
            })
          } else {
            worker.respond(resultFor(message.jobId))
          }
        }),
    })

    await expect(pool.run(task('a'))).rejects.toThrow('bad file')
    await expect(pool.run(task('b'))).resolves.toMatchObject({ jobId: 'b' })
  })

  it('recovers from a worker crash without stalling', async () => {
    let created = 0
    const pool = new WorkerPool({
      size: 1,
      createWorker: () => {
        created += 1
        const index = created
        return new FakeWorker((worker, message) => {
          if (index === 1) worker.crash('boom')
          else worker.respond(resultFor(message.jobId))
        })
      },
    })

    await expect(pool.run(task('a'))).rejects.toThrow('boom')
    await expect(pool.run(task('b'))).resolves.toMatchObject({ jobId: 'b' })
    expect(created).toBe(2)
  })

  it('never exceeds the configured pool size and queues the rest', async () => {
    const created: FakeWorker[] = []
    const pool = new WorkerPool({
      size: 2,
      createWorker: () => {
        const worker = new FakeWorker(() => {})
        created.push(worker)
        return worker
      },
    })

    const promises = [
      pool.run(task('a')),
      pool.run(task('b')),
      pool.run(task('c')),
    ]

    expect(created).toHaveLength(2)
    expect(pool.workerCount).toBe(2)
    expect(
      created.reduce((total, worker) => total + worker.posted.length, 0),
    ).toBe(2)

    pool.terminate()
    await Promise.allSettled(promises)
  })

  it('dispatches queued jobs in FIFO order', async () => {
    const order: string[] = []
    const releases: Array<() => void> = []
    const pool = new WorkerPool({
      size: 1,
      createWorker: () =>
        new FakeWorker((worker, message) => {
          order.push(message.jobId)
          releases.push(() => worker.respond(resultFor(message.jobId)))
        }),
    })

    const first = pool.run(task('a'))
    const second = pool.run(task('b'))
    const third = pool.run(task('c'))

    releases.shift()?.()
    await first
    releases.shift()?.()
    await second
    releases.shift()?.()
    await third

    expect(order).toEqual(['a', 'b', 'c'])
    pool.terminate()
  })

  it('reports busy and queued counts and notifies on change', async () => {
    const releases: Array<() => void> = []
    let changes = 0
    const pool = new WorkerPool({
      size: 1,
      onChange: () => {
        changes += 1
      },
      createWorker: () =>
        new FakeWorker((worker, message) => {
          releases.push(() => worker.respond(resultFor(message.jobId)))
        }),
    })

    const first = pool.run(task('a'))
    const second = pool.run(task('b'))

    expect(pool.busyCount).toBe(1)
    expect(pool.queuedCount).toBe(1)
    expect(changes).toBeGreaterThan(0)

    releases.shift()?.()
    await first
    expect(pool.busyCount).toBe(1)
    expect(pool.queuedCount).toBe(0)

    releases.shift()?.()
    await second
    expect(pool.busyCount).toBe(0)
    expect(pool.queuedCount).toBe(0)

    pool.terminate()
  })
})
