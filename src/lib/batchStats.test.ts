import { describe, expect, it } from 'vitest'
import {
  applyJobChange,
  type BatchStats,
  computeBatchStats,
  EMPTY_BATCH_STATS,
  recomputeReady,
  type StatsJob,
} from './batchStats'

const KEY = 'jpeg|edge=0|quality=75'

function job(overrides: Partial<StatsJob> = {}): StatsJob {
  return {
    status: 'queued',
    originalSize: 1000,
    outputSize: 0,
    outputKey: '',
    hasBlob: false,
    ...overrides,
  }
}

describe('computeBatchStats', () => {
  it('counts queued jobs as pending and active', () => {
    const stats = computeBatchStats([job(), job()], KEY)
    expect(stats.total).toBe(2)
    expect(stats.pending).toBe(2)
    expect(stats.active).toBe(2)
    expect(stats.originalBytes).toBe(2000)
    expect(stats.finished).toBe(0)
  })

  it('separates finished, failed, and processing', () => {
    const stats = computeBatchStats(
      [
        job({ status: 'done', outputKey: KEY, outputSize: 200, hasBlob: true }),
        job({ status: 'error' }),
        job({ status: 'processing' }),
      ],
      KEY,
    )
    expect(stats.finished).toBe(2)
    expect(stats.failed).toBe(1)
    expect(stats.processing).toBe(1)
    expect(stats.active).toBe(2)
    expect(stats.originalBytes).toBe(2000)
    expect(stats.ready).toBe(1)
    expect(stats.readyBytes).toBe(200)
    expect(stats.readyDownloadable).toBe(1)
  })

  it('ignores errored jobs for input byte totals', () => {
    const stats = computeBatchStats(
      [job({ status: 'error', originalSize: 5000 }), job()],
      KEY,
    )
    expect(stats.originalBytes).toBe(1000)
  })
})

describe('applyJobChange', () => {
  it('matches a full recompute across a transition sequence', () => {
    const first = job()
    let stats: BatchStats = EMPTY_BATCH_STATS
    stats = applyJobChange(stats, null, first, KEY)
    const second = job({ status: 'processing' })
    stats = applyJobChange(stats, first, second, KEY)
    stats = applyJobChange(stats, second, job({ status: 'estimating' }), KEY)

    const expected = computeBatchStats([job({ status: 'estimating' })], KEY)
    expect(stats).toEqual(expected)
  })

  it('promotes a job to ready when it finishes on the current key', () => {
    const before = job({ status: 'estimated', outputSize: 0 })
    const after = job({
      status: 'done',
      outputKey: KEY,
      outputSize: 250,
      hasBlob: true,
    })
    const stats = applyJobChange(EMPTY_BATCH_STATS, before, after, KEY)
    expect(stats.ready).toBe(1)
    expect(stats.readyBytes).toBe(250)
    expect(stats.readyDownloadable).toBe(1)
    expect(stats.finished).toBe(1)
  })

  it('returns the same object for non-aggregate patches', () => {
    const base: BatchStats = { ...EMPTY_BATCH_STATS, total: 1, active: 1 }
    const before = job({ status: 'estimated' })
    const after = { ...before }
    expect(applyJobChange(base, before, after, KEY)).toBe(base)
  })
})

describe('recomputeReady', () => {
  it('recomputes ready counters after the output key changes', () => {
    const stats = computeBatchStats(
      [
        job({
          status: 'done',
          outputKey: 'old',
          outputSize: 500,
          hasBlob: true,
        }),
      ],
      'old',
    )
    expect(stats.ready).toBe(1)
    const updated = recomputeReady(
      stats,
      [job({ status: 'done', outputKey: 'old' })],
      KEY,
    )
    expect(updated.ready).toBe(0)
    expect(updated.readyBytes).toBe(0)
    expect(updated.active).toBe(1)
  })

  it('returns the same object when nothing changed', () => {
    const stats = computeBatchStats([], KEY)
    expect(recomputeReady(stats, [], KEY)).toBe(stats)
  })
})
