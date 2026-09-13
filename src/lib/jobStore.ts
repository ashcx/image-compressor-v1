import { type Signal, signal } from '@preact/signals'
import {
  applyJobChange,
  type BatchStats,
  EMPTY_BATCH_STATS,
  recomputeReady,
  type StatsJob,
} from './batchStats'

export interface BatchJobBase {
  id: string
}

export interface JobStoreOptions<T extends BatchJobBase> {
  /** Current output key; jobs whose `outputKey` matches count as "ready". */
  getOutputKey: () => string
  /** Maps a stored job to the aggregate-relevant subset. */
  toStats: (job: T) => StatsJob
}

export interface JobStore<T extends BatchJobBase> {
  /** Job ids in insertion order. Only changes on add/remove/clear. */
  readonly order: Signal<string[]>
  /** Incrementally maintained batch aggregates. */
  readonly stats: Signal<BatchStats>
  /** Bumped on any add/update/remove, for coalesced derived recomputes. */
  readonly revision: Signal<number>
  add(jobs: T[]): void
  update(id: string, patch: Partial<T>): T | undefined
  remove(id: string): void
  clear(): void
  get(id: string): T | undefined
  list(): T[]
  signalFor(id: string): Signal<T> | undefined
  /** Recompute current-output counters after the output key changes. */
  refreshReady(): void
}

/**
 * Per-job store that keeps a plain data map for cheap aggregate scans and a
 * per-id signal for isolated row rendering. Bulk additions update the id array
 * and aggregates once, avoiding the O(n²) copying of per-file inserts.
 */
export function createJobStore<T extends BatchJobBase>(
  options: JobStoreOptions<T>,
): JobStore<T> {
  const order = signal<string[]>([])
  const stats = signal<BatchStats>({ ...EMPTY_BATCH_STATS })
  const revision = signal(0)
  const data = new Map<string, T>()
  const signals = new Map<string, Signal<T>>()

  const bump = () => {
    revision.value += 1
  }

  const add = (jobs: T[]): void => {
    if (jobs.length === 0) return
    const key = options.getOutputKey()
    let next = stats.value
    for (const job of jobs) {
      data.set(job.id, job)
      signals.set(job.id, signal(job))
      next = applyJobChange(next, null, options.toStats(job), key)
    }
    order.value = [...order.value, ...jobs.map((job) => job.id)]
    stats.value = next
    bump()
  }

  const update = (id: string, patch: Partial<T>): T | undefined => {
    const before = data.get(id)
    if (!before) return undefined
    const after = { ...before, ...patch }
    data.set(id, after)
    const rowSignal = signals.get(id)
    if (rowSignal) rowSignal.value = after
    const next = applyJobChange(
      stats.value,
      options.toStats(before),
      options.toStats(after),
      options.getOutputKey(),
    )
    if (next !== stats.value) stats.value = next
    bump()
    return after
  }

  const remove = (id: string): void => {
    const job = data.get(id)
    data.delete(id)
    signals.delete(id)
    order.value = order.value.filter((candidate) => candidate !== id)
    if (job) {
      stats.value = applyJobChange(
        stats.value,
        options.toStats(job),
        null,
        options.getOutputKey(),
      )
    }
    bump()
  }

  const clear = (): void => {
    data.clear()
    signals.clear()
    order.value = []
    stats.value = { ...EMPTY_BATCH_STATS }
    bump()
  }

  const list = (): T[] => {
    const jobs: T[] = []
    for (const id of order.value) {
      const job = data.get(id)
      if (job) jobs.push(job)
    }
    return jobs
  }

  const refreshReady = (): void => {
    const next = recomputeReady(
      stats.value,
      list().map(options.toStats),
      options.getOutputKey(),
    )
    if (next !== stats.value) {
      stats.value = next
      bump()
    }
  }

  return {
    order,
    stats,
    revision,
    add,
    update,
    remove,
    clear,
    get: (id) => data.get(id),
    list,
    signalFor: (id) => signals.get(id),
    refreshReady,
  }
}
