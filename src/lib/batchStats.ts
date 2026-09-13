export type JobStatus =
  | 'queued'
  | 'estimating'
  | 'estimated'
  | 'processing'
  | 'done'
  | 'error'

/**
 * The subset of a job that affects batch aggregates. Kept structural so the
 * reducer and its tests do not depend on the UI job shape.
 */
export interface StatsJob {
  status: JobStatus
  originalSize: number
  outputSize: number
  outputKey: string
  hasBlob: boolean
}

export interface BatchStats {
  total: number
  /** Jobs that have settled as done or error. */
  finished: number
  failed: number
  /** Jobs still queued or estimating. */
  pending: number
  processing: number
  /** Jobs that can still produce output (not errored). */
  active: number
  /** Sum of original bytes for non-errored jobs. */
  originalBytes: number
  /** Done jobs matching the current output key. */
  ready: number
  readyBytes: number
  /** Done, current jobs that still hold their output blob. */
  readyDownloadable: number
}

export const EMPTY_BATCH_STATS: BatchStats = {
  total: 0,
  finished: 0,
  failed: 0,
  pending: 0,
  processing: 0,
  active: 0,
  originalBytes: 0,
  ready: 0,
  readyBytes: 0,
  readyDownloadable: 0,
}

type Counters = Omit<BatchStats, 'total'>

const ZERO: Counters = {
  finished: 0,
  failed: 0,
  pending: 0,
  processing: 0,
  active: 0,
  originalBytes: 0,
  ready: 0,
  readyBytes: 0,
  readyDownloadable: 0,
}

function counters(job: StatsJob, outputKey: string): Counters {
  const done = job.status === 'done'
  const errored = job.status === 'error'
  const current = done && job.outputKey === outputKey
  return {
    finished: done || errored ? 1 : 0,
    failed: errored ? 1 : 0,
    pending: job.status === 'queued' || job.status === 'estimating' ? 1 : 0,
    processing: job.status === 'processing' ? 1 : 0,
    active: errored ? 0 : 1,
    originalBytes: errored ? 0 : job.originalSize,
    ready: current ? 1 : 0,
    readyBytes: current ? job.outputSize : 0,
    readyDownloadable: current && job.hasBlob ? 1 : 0,
  }
}

function diff(a: Counters, b: Counters): Counters {
  return {
    finished: b.finished - a.finished,
    failed: b.failed - a.failed,
    pending: b.pending - a.pending,
    processing: b.processing - a.processing,
    active: b.active - a.active,
    originalBytes: b.originalBytes - a.originalBytes,
    ready: b.ready - a.ready,
    readyBytes: b.readyBytes - a.readyBytes,
    readyDownloadable: b.readyDownloadable - a.readyDownloadable,
  }
}

function isEmpty(delta: Counters): boolean {
  return (
    delta.finished === 0 &&
    delta.failed === 0 &&
    delta.pending === 0 &&
    delta.processing === 0 &&
    delta.active === 0 &&
    delta.originalBytes === 0 &&
    delta.ready === 0 &&
    delta.readyBytes === 0 &&
    delta.readyDownloadable === 0
  )
}

function apply(stats: BatchStats, delta: Counters): BatchStats {
  return {
    total: stats.total,
    finished: stats.finished + delta.finished,
    failed: stats.failed + delta.failed,
    pending: stats.pending + delta.pending,
    processing: stats.processing + delta.processing,
    active: stats.active + delta.active,
    originalBytes: stats.originalBytes + delta.originalBytes,
    ready: stats.ready + delta.ready,
    readyBytes: stats.readyBytes + delta.readyBytes,
    readyDownloadable: stats.readyDownloadable + delta.readyDownloadable,
  }
}

/**
 * Incrementally folds one job transition into the aggregate. `before`/`after`
 * are the job state around the change (null when added/removed). Returns the
 * same object when nothing aggregate-relevant changed, so signal subscribers
 * are not woken for width/height-only patches.
 */
export function applyJobChange(
  stats: BatchStats,
  before: StatsJob | null,
  after: StatsJob | null,
  outputKey: string,
): BatchStats {
  const delta = diff(
    before ? counters(before, outputKey) : ZERO,
    after ? counters(after, outputKey) : ZERO,
  )
  const totalDelta = (after ? 1 : 0) - (before ? 1 : 0)
  if (totalDelta === 0 && isEmpty(delta)) return stats
  return { ...apply(stats, delta), total: stats.total + totalDelta }
}

/** Full recompute, used as the correctness reference for the reducer. */
export function computeBatchStats(
  jobs: StatsJob[],
  outputKey: string,
): BatchStats {
  let stats: BatchStats = { ...EMPTY_BATCH_STATS }
  for (const job of jobs) stats = applyJobChange(stats, null, job, outputKey)
  return stats
}

/**
 * Recomputes only the current-output counters. Called when the output key
 * changes, since every job's "ready" flag is relative to that key.
 */
export function recomputeReady(
  stats: BatchStats,
  jobs: StatsJob[],
  outputKey: string,
): BatchStats {
  let ready = 0
  let readyBytes = 0
  let readyDownloadable = 0
  for (const job of jobs) {
    if (job.status !== 'done' || job.outputKey !== outputKey) continue
    ready += 1
    readyBytes += job.outputSize
    if (job.hasBlob) readyDownloadable += 1
  }
  if (
    ready === stats.ready &&
    readyBytes === stats.readyBytes &&
    readyDownloadable === stats.readyDownloadable
  ) {
    return stats
  }
  return { ...stats, ready, readyBytes, readyDownloadable }
}
