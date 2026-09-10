import { computed, signal } from '@preact/signals'
import type { JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { type EstimateSample, interpolate } from './lib/estimate'
import { formatBytes, percentReduction, replaceExtension } from './lib/format'
import { getPoolStats, processImage, subscribeToPool } from './lib/workerClient'

type JobStatus =
  | 'queued'
  | 'estimating'
  | 'estimated'
  | 'processing'
  | 'done'
  | 'error'

interface BatchJob {
  id: string
  name: string
  file: File
  originalSize: number
  status: JobStatus
  outputUrl: string
  outputExtension: string
  outputSize: number
  sizeIsExact: boolean
  compressedQuality: number | null
  width: number
  height: number
  samples: EstimateSample[]
  error: string
}

const jobs = signal<BatchJob[]>([])
const quality = signal(75)
const isDragging = signal(false)
const poolStats = signal(getPoolStats())

let idCounter = 0
let reprocessTimer: ReturnType<typeof setTimeout> | undefined
const jobTokens = new Map<string, number>()

const total = computed(() => jobs.value.length)
const batchMode = computed(() => jobs.value.length > 1)
const finished = computed(
  () =>
    jobs.value.filter((job) => job.status === 'done' || job.status === 'error')
      .length,
)
const failed = computed(
  () => jobs.value.filter((job) => job.status === 'error').length,
)
const progressPercent = computed(() =>
  total.value === 0 ? 0 : Math.round((finished.value / total.value) * 100),
)
const pendingEstimate = computed(
  () =>
    jobs.value.filter(
      (job) => job.status === 'queued' || job.status === 'estimating',
    ).length,
)
const estimatePhase = computed(
  () => batchMode.value && pendingEstimate.value > 0,
)
const phasePercent = computed(() => {
  if (total.value === 0) return 0
  if (estimatePhase.value)
    return Math.round(
      ((total.value - pendingEstimate.value) / total.value) * 100,
    )
  return progressPercent.value
})
const phaseLabel = computed(() =>
  estimatePhase.value
    ? `Estimating sizes… ${total.value - pendingEstimate.value} / ${total.value}`
    : `${finished.value} / ${total.value} compressed${failed.value > 0 ? ` · ${failed.value} failed` : ''}`,
)
const isCurrent = (job: BatchJob) =>
  job.status === 'done' && job.compressedQuality === quality.value
const needsCompress = computed(() =>
  jobs.value.some(
    (job) =>
      job.status === 'estimated' ||
      (job.status === 'done' && job.compressedQuality !== quality.value),
  ),
)
const batchEstimate = computed(() =>
  jobs.value.reduce((sum, job) => {
    if (job.status === 'error') return sum
    if (isCurrent(job)) return sum + job.outputSize
    if (job.samples.length > 0)
      return sum + interpolate(job.samples, quality.value)
    return sum
  }, 0),
)

function nextToken(id: string): number {
  const token = (jobTokens.get(id) ?? 0) + 1
  jobTokens.set(id, token)
  return token
}

function updateJob(id: string, patch: Partial<BatchJob>) {
  jobs.value = jobs.value.map((job) =>
    job.id === id ? { ...job, ...patch } : job,
  )
}

async function estimateJob(id: string) {
  const token = nextToken(id)
  const job = jobs.value.find((candidate) => candidate.id === id)
  if (!job) return

  updateJob(id, { status: 'estimating', error: '' })

  try {
    const buffer = await job.file.arrayBuffer()
    const { response } = processImage({
      fileBuffer: buffer,
      targetFormat: 'webp',
      estimateOnly: true,
    })
    const result = await response
    if (jobTokens.get(id) !== token || result.type !== 'estimate') return

    updateJob(id, {
      status: 'estimated',
      samples: result.samples,
      width: result.width,
      height: result.height,
      outputSize: interpolate(result.samples, quality.value),
      sizeIsExact: false,
    })
  } catch (error) {
    if (jobTokens.get(id) !== token) return
    updateJob(id, {
      status: 'error',
      error: error instanceof Error ? error.message : 'Conversion failed',
    })
  }
}

async function compressJob(id: string) {
  const token = nextToken(id)
  const job = jobs.value.find((candidate) => candidate.id === id)
  if (!job) return

  updateJob(id, { status: 'processing', error: '' })

  try {
    const buffer = await job.file.arrayBuffer()
    const { response } = processImage({
      fileBuffer: buffer,
      targetFormat: 'webp',
      quality: quality.value,
      buildEstimate: job.samples.length === 0,
    })
    const result = await response
    if (jobTokens.get(id) !== token || result.type !== 'result') return

    const previousUrl = job.outputUrl
    const url = URL.createObjectURL(
      new Blob([result.outputBuffer], { type: result.mimeType }),
    )
    updateJob(id, {
      status: 'done',
      outputUrl: url,
      outputExtension: result.extension,
      outputSize: result.outputSize,
      sizeIsExact: true,
      compressedQuality: quality.value,
      width: result.width,
      height: result.height,
      ...(result.samples ? { samples: result.samples } : {}),
    })
    if (previousUrl) URL.revokeObjectURL(previousUrl)
  } catch (error) {
    if (jobTokens.get(id) !== token) return
    updateJob(id, {
      status: 'error',
      error: error instanceof Error ? error.message : 'Conversion failed',
    })
  }
}

function addFiles(fileList: FileList | File[] | null) {
  if (!fileList) return
  const incoming = Array.from(fileList)
  if (incoming.length === 0) return

  const created: BatchJob[] = incoming.map((file) => ({
    id: `file-${++idCounter}`,
    name: file.name,
    file,
    originalSize: file.size,
    status: 'queued',
    outputUrl: '',
    outputExtension: 'webp',
    outputSize: 0,
    sizeIsExact: false,
    compressedQuality: null,
    width: 0,
    height: 0,
    samples: [],
    error: '',
  }))

  jobs.value = [...jobs.value, ...created]

  // A lone image is compressed right away; a batch is only estimated so the user
  // can dial in settings before any expensive encoding happens.
  const isBatch = jobs.value.length > 1
  for (const job of created) {
    if (isBatch) void estimateJob(job.id)
    else void compressJob(job.id)
  }
}

function refreshEstimates() {
  jobs.value = jobs.value.map((job) => {
    if (job.samples.length === 0) return job
    const current = isCurrent(job)
    return {
      ...job,
      outputSize: current
        ? job.outputSize
        : interpolate(job.samples, quality.value),
      sizeIsExact: current,
    }
  })
}

function recompressSingle() {
  if (reprocessTimer) clearTimeout(reprocessTimer)
  reprocessTimer = setTimeout(() => {
    for (const job of jobs.value) {
      if (job.status === 'error') continue
      void compressJob(job.id)
    }
  }, 200)
}

function compressAll() {
  if (reprocessTimer) clearTimeout(reprocessTimer)
  for (const job of jobs.value) {
    if (job.status === 'error' || job.status === 'processing') continue
    if (job.status === 'estimated' || job.compressedQuality !== quality.value) {
      void compressJob(job.id)
    }
  }
}

function removeJob(id: string) {
  nextToken(id)
  const job = jobs.value.find((candidate) => candidate.id === id)
  if (job?.outputUrl) URL.revokeObjectURL(job.outputUrl)
  jobs.value = jobs.value.filter((candidate) => candidate.id !== id)
}

function clearAll() {
  if (reprocessTimer) clearTimeout(reprocessTimer)
  for (const job of jobs.value) {
    nextToken(job.id)
    if (job.outputUrl) URL.revokeObjectURL(job.outputUrl)
  }
  jobs.value = []
}

function savingsLabel(originalSize: number, outputSize: number): string {
  const percent = percentReduction(originalSize, outputSize)
  return percent >= 0 ? `−${percent}%` : `+${Math.abs(percent)}%`
}

function statusLabel(job: BatchJob): string {
  switch (job.status) {
    case 'queued':
      return 'queued'
    case 'estimating':
      return 'estimating…'
    case 'estimated':
      return 'not compressed yet'
    case 'processing':
      return 'compressing…'
    case 'done':
      return isCurrent(job) ? '' : 'quality changed — re-compress'
    case 'error':
      return job.error
  }
}

export function App() {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return subscribeToPool(() => {
      poolStats.value = getPoolStats()
    })
  }, [])

  function onInputChange(event: JSX.TargetedEvent<HTMLInputElement, Event>) {
    addFiles(event.currentTarget.files)
    event.currentTarget.value = ''
  }

  function onDrop(event: JSX.TargetedDragEvent<HTMLButtonElement>) {
    event.preventDefault()
    isDragging.value = false
    addFiles(event.dataTransfer?.files ?? null)
  }

  function onDragOver(event: JSX.TargetedDragEvent<HTMLButtonElement>) {
    event.preventDefault()
    isDragging.value = true
  }

  const jobList = jobs.value
  const originalTotal = jobList.reduce(
    (sum, job) => (job.status === 'error' ? sum : sum + job.originalSize),
    0,
  )

  return (
    <main class="app">
      <header class="app__header">
        <h1>Image Compressor</h1>
        <p>
          Convert and compress images entirely in your browser. Nothing is
          uploaded — your files never leave this device.
        </p>
      </header>

      <button
        type="button"
        class={`dropzone${isDragging.value ? ' dropzone--active' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={() => {
          isDragging.value = false
        }}
      >
        <span class="dropzone__title">Drop images here</span>
        <span class="dropzone__hint">
          or click to choose files (JPEG, PNG, WebP). Single images compress
          immediately; batches are estimated first.
        </span>
      </button>

      <input
        ref={inputRef}
        class="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={onInputChange}
      />

      {jobList.length > 0 && (
        <>
          <section class="panel">
            <label class="field">
              <span class="field__label">Quality: {quality.value}</span>
              <input
                type="range"
                min={1}
                max={100}
                value={quality.value}
                onInput={(event) => {
                  quality.value = Number(event.currentTarget.value)
                  refreshEstimates()
                  if (!batchMode.value) recompressSingle()
                }}
              />
            </label>

            <div class="progress" aria-hidden="true">
              <div
                class="progress__bar"
                style={{ width: `${phasePercent.value}%` }}
              />
            </div>

            <div class="panel__row">
              <span class="panel__label">{phaseLabel.value}</span>
              <span class="panel__value">
                workers busy: {poolStats.value.busy}/{poolStats.value.size}
              </span>
            </div>

            {batchMode.value && total.value > 0 && (
              <div class="panel__row">
                <span class="panel__label">Batch estimate</span>
                <span class="panel__value">
                  {estimatePhase.value ? (
                    'calculating…'
                  ) : (
                    <>
                      {needsCompress.value ? '~' : ''}
                      {formatBytes(batchEstimate.value)}
                      {originalTotal > 0
                        ? ` (${savingsLabel(originalTotal, batchEstimate.value)})`
                        : ''}
                    </>
                  )}
                </span>
              </div>
            )}

            {needsCompress.value && (
              <button
                type="button"
                class="button button--primary"
                onClick={compressAll}
              >
                Compress{' '}
                {jobList.length > 1 ? `all ${jobList.length} images` : 'image'}
              </button>
            )}

            <button type="button" class="button" onClick={clearAll}>
              Clear all
            </button>
          </section>

          <ul class="jobs">
            {jobList.map((job) => {
              const current = isCurrent(job)
              const label = statusLabel(job)
              return (
                <li class="job" key={job.id}>
                  <div class="job__thumb">
                    {job.status === 'processing' ? (
                      <span class="job__spinner" />
                    ) : job.status === 'error' ? (
                      <span class="job__icon job__icon--error">!</span>
                    ) : job.outputUrl ? (
                      <img
                        class={current ? '' : 'job__thumb--stale'}
                        src={job.outputUrl}
                        alt=""
                      />
                    ) : job.status === 'estimated' ? (
                      <span class="job__icon job__icon--ready">≈</span>
                    ) : (
                      <span class="job__icon job__icon--idle">…</span>
                    )}
                  </div>
                  <div class="job__info">
                    <span class="job__name" title={job.name}>
                      {job.name}
                    </span>
                    <span
                      class={`job__meta${job.status === 'error' ? ' job__meta--error' : ''}`}
                    >
                      {formatBytes(job.originalSize)}
                      {job.outputSize > 0 && (
                        <>
                          {' → '}
                          {job.sizeIsExact ? '' : '~'}
                          {formatBytes(job.outputSize)} (
                          {savingsLabel(job.originalSize, job.outputSize)})
                        </>
                      )}
                      {label && ` · ${label}`}
                    </span>
                  </div>
                  <div class="job__actions">
                    {current && job.outputUrl && (
                      <a
                        class="button button--small"
                        href={job.outputUrl}
                        download={replaceExtension(
                          job.name,
                          job.outputExtension,
                        )}
                      >
                        Download
                      </a>
                    )}
                    <button
                      type="button"
                      class="icon-button"
                      title="Remove"
                      aria-label={`Remove ${job.name}`}
                      onClick={() => removeJob(job.id)}
                    >
                      ×
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {jobList.length > 0 && batchMode.value && (
        <p class="footnote">
          Batch mode: change the quality as much as you like — sizes update from
          cached estimates instantly. Nothing is encoded until you press
          Compress.
        </p>
      )}
    </main>
  )
}
