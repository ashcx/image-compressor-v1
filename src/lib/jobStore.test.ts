import { describe, expect, it } from 'vitest'
import type { StatsJob } from './batchStats'
import { createJobStore } from './jobStore'

interface TestJob {
  id: string
  name: string
  status: StatsJob['status']
  originalSize: number
  outputSize: number
  outputKey: string
  hasBlob: boolean
}

function makeJob(id: string, overrides: Partial<TestJob> = {}): TestJob {
  return {
    id,
    name: `${id}.jpg`,
    status: 'queued',
    originalSize: 100,
    outputSize: 0,
    outputKey: '',
    hasBlob: false,
    ...overrides,
  }
}

function makeStore(outputKey = 'k') {
  let key = outputKey
  const store = createJobStore<TestJob>({
    getOutputKey: () => key,
    toStats: (job) => ({
      status: job.status,
      originalSize: job.originalSize,
      outputSize: job.outputSize,
      outputKey: job.outputKey,
      hasBlob: job.hasBlob,
    }),
  })
  return { store, setKey: (next: string) => (key = next) }
}

describe('job store bulk insertion', () => {
  it('inserts many jobs in one order update', () => {
    const { store } = makeStore()
    const jobs = [makeJob('a'), makeJob('b'), makeJob('c')]
    store.add(jobs)
    expect(store.order.value).toEqual(['a', 'b', 'c'])
    expect(store.stats.value.total).toBe(3)
    expect(store.stats.value.pending).toBe(3)
  })

  it('preserves ordering and duplicate filenames', () => {
    const { store } = makeStore()
    store.add([
      makeJob('a', { name: 'photo.jpg' }),
      makeJob('b', { name: 'photo.jpg' }),
      makeJob('c', { name: 'photo.jpg' }),
    ])
    expect(store.list().map((job) => job.name)).toEqual([
      'photo.jpg',
      'photo.jpg',
      'photo.jpg',
    ])
    expect(store.order.value).toEqual(['a', 'b', 'c'])
  })

  it('adds jobs across two batches without disturbing order', () => {
    const { store } = makeStore()
    store.add([makeJob('a')])
    store.add([makeJob('b'), makeJob('c')])
    expect(store.order.value).toEqual(['a', 'b', 'c'])
    expect(store.stats.value.total).toBe(3)
  })
})

describe('job store aggregate transitions', () => {
  it('tracks a job from queued to done and ready', () => {
    const { store } = makeStore()
    store.add([makeJob('a')])
    store.update('a', { status: 'processing' })
    expect(store.stats.value.processing).toBe(1)
    store.update('a', {
      status: 'done',
      outputKey: 'k',
      outputSize: 40,
      hasBlob: true,
    })
    expect(store.stats.value.finished).toBe(1)
    expect(store.stats.value.processing).toBe(0)
    expect(store.stats.value.ready).toBe(1)
    expect(store.stats.value.readyDownloadable).toBe(1)
    expect(store.stats.value.readyBytes).toBe(40)
  })

  it('removes a job and its contribution', () => {
    const { store } = makeStore()
    store.add([makeJob('a'), makeJob('b')])
    store.remove('a')
    expect(store.order.value).toEqual(['b'])
    expect(store.stats.value.total).toBe(1)
    expect(store.stats.value.originalBytes).toBe(100)
  })

  it('clears everything', () => {
    const { store } = makeStore()
    store.add([makeJob('a'), makeJob('b')])
    store.clear()
    expect(store.order.value).toEqual([])
    expect(store.get('a')).toBeUndefined()
    expect(store.stats.value.total).toBe(0)
  })

  it('recomputes ready counters when the output key changes', () => {
    const { store, setKey } = makeStore()
    store.add([
      makeJob('a', {
        status: 'done',
        outputKey: 'k',
        outputSize: 40,
        hasBlob: true,
      }),
    ])
    expect(store.stats.value.ready).toBe(1)
    setKey('k2')
    store.refreshReady()
    expect(store.stats.value.ready).toBe(0)
    expect(store.stats.value.active).toBe(1)
  })
})

describe('job store row signals', () => {
  it('bumps only the changed row signal version on update', () => {
    const { store } = makeStore()
    store.add([makeJob('a'), makeJob('b')])
    const a = store.signalFor('a')
    const b = store.signalFor('b')
    store.update('a', { outputSize: 10 })
    expect(a?.value.outputSize).toBe(10)
    expect(b?.value.outputSize).toBe(0)
  })

  it('bumps the revision on add, update, and remove', () => {
    const { store } = makeStore()
    const start = store.revision.value
    store.add([makeJob('a')])
    store.update('a', { outputSize: 5 })
    store.remove('a')
    expect(store.revision.value).toBe(start + 3)
  })
})
