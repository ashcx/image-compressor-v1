import { computed, signal } from '@preact/signals'
import type { JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { type EstimateSample, interpolate } from './lib/estimate'
import { formatBytes, percentReduction, replaceExtension } from './lib/format'
import { getPoolStats, processImage, subscribeToPool } from './lib/workerClient'

type JobStatus = 'queued' | 'processing' | 'done' | 'error'

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
  width: number
  height: number
  samples: EstimateSample[]
  error: string
}

const QUALITY_DEBOUNCE_MS = 200

const jobs = signal<BatchJob[]>([])
const quality = signal(75)
const isDragging = signal(false)
const poolStats = signal(getPoolStats())

let idCounter = 0
let reprocessTimer: ReturnType<typeof setTimeout> | undefined
const jobTokens = new Map<string, number>()

const total = computed(() => jobs.value.length)
const finished = computed(
  () =>
    jobs.value.filter((job) => job.status === 'done' || job.status === 'error')
      .length,
)
const failed = computed(
  () => jobs.value.filter((job) => job.status === 'error').length,
)
const active = computed(
  () =>
    jobs.value.filter(
      (job) => job.status === 'processing' || job.status === 'queued',
    ).length,
)
const progressPercent = computed(() =>
  total.value === 0 ? 0 : Math.round((finished.value / total.value) * 100),
)

function updateJob(id: string, patch: Partial<BatchJob>) {
  jobs.value = jobs.value.map((job) =>
    job.id === id ? { ...job, ...patch } : job,
  )
}

async function processJob(id: string, buildEstimate: boolean) {
  const token = (jobTokens.get(id) ?? 0) + 1
  jobTokens.set(id, token)

  const job = jobs.value.find((candidate) => candidate.id === id)
  if (!job) return

  updateJob(id, { status: 'processing', error: '' })

  try {
    const buffer = await job.file.arrayBuffer()
    const { response } = processImage({
      fileBuffer: buffer,
      targetFormat: 'webp',
      quality: quality.value,
      buildEstimate,
    })
    const result = await response
    if (jobTokens.get(id) !== token) return

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
    width: 0,
    height: 0,
    samples: [],
    error: '',
  }))

  jobs.value = [...jobs.value, ...created]
  for (const job of created) void processJob(job.id, true)
}

function refreshEstimates() {
  jobs.value = jobs.value.map((job) =>
    job.samples.length === 0
      ? job
      : {
          ...job,
          outputSize: interpolate(job.samples, quality.value),
          sizeIsExact: false,
        },
  )
}

function reprocessAll() {
  for (const job of jobs.value) {
    if (job.status === 'error') continue
    void processJob(job.id, job.samples.length === 0)
  }
}

function scheduleReprocess() {
  if (reprocessTimer) clearTimeout(reprocessTimer)
  reprocessTimer = setTimeout(reprocessAll, QUALITY_DEBOUNCE_MS)
}

function removeJob(id: string) {
  jobTokens.set(id, (jobTokens.get(id) ?? 0) + 1)
  const job = jobs.value.find((candidate) => candidate.id === id)
  if (job?.outputUrl) URL.revokeObjectURL(job.outputUrl)
  jobs.value = jobs.value.filter((candidate) => candidate.id !== id)
}

function clearAll() {
  if (reprocessTimer) clearTimeout(reprocessTimer)
  for (const job of jobs.value) {
    jobTokens.set(job.id, (jobTokens.get(job.id) ?? 0) + 1)
    if (job.outputUrl) URL.revokeObjectURL(job.outputUrl)
  }
  jobs.value = []
}

function savingsLabel(job: BatchJob): string {
  const percent = percentReduction(job.originalSize, job.outputSize)
  return percent >= 0 ? `−${percent}%` : `+${Math.abs(percent)}%`
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
          or click to choose files (JPEG, PNG, WebP)
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
                  scheduleReprocess()
                }}
              />
            </label>

            <div class="progress" aria-hidden="true">
              <div
                class="progress__bar"
                style={{ width: `${progressPercent.value}%` }}
              />
            </div>

            <div class="panel__row">
              <span class="panel__label">
                {finished.value} / {total.value} done
                {failed.value > 0 ? ` · ${failed.value} failed` : ''}
              </span>
              <span class="panel__value">
                workers busy: {poolStats.value.busy}/{poolStats.value.size}
              </span>
            </div>

            <button type="button" class="button" onClick={clearAll}>
              Clear all
            </button>
          </section>

          <ul class="jobs">
            {jobList.map((job) => (
              <li class="job" key={job.id}>
                <div class="job__thumb">
                  {job.outputUrl ? (
                    <img src={job.outputUrl} alt="" />
                  ) : (
                    <span
                      class={
                        job.status === 'error'
                          ? 'job__placeholder job__placeholder--error'
                          : 'job__placeholder'
                      }
                    />
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
                        {formatBytes(job.outputSize)} ({savingsLabel(job)})
                      </>
                    )}
                    {job.status === 'processing' && ' · processing'}
                    {job.status === 'queued' && ' · queued'}
                    {job.status === 'error' && ` · ${job.error}`}
                  </span>
                </div>
                <div class="job__actions">
                  {job.outputUrl && (
                    <a
                      class="button button--small"
                      href={job.outputUrl}
                      download={replaceExtension(job.name, job.outputExtension)}
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
            ))}
          </ul>
        </>
      )}

      {jobList.length > 0 && active.value > 0 && (
        <p class="footnote">
          {active.value} file{active.value === 1 ? '' : 's'} in progress across{' '}
          {poolStats.value.size} worker slots.
        </p>
      )}
    </main>
  )
}
