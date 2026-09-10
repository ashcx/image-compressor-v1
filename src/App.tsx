import { computed, signal } from '@preact/signals'
import type { JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import {
  type ControlKey,
  FORMAT_ORDER,
  FORMAT_SPECS,
} from './lib/codecs/formats'
import type { OutputFormat } from './lib/codecs/types'
import { type EstimateSample, interpolate } from './lib/estimate'
import { formatBytes, percentReduction, replaceExtension } from './lib/format'
import { appVersion, watchForUpdates } from './lib/version'
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
  outputKey: string
  sampleKey: string
  width: number
  height: number
  samples: EstimateSample[]
  error: string
}

interface Settings {
  quality: number
  effort: number
  speed: number
}

function defaultSettings(format: OutputFormat): Settings {
  const base: Settings = { quality: 75, effort: 2, speed: 6 }
  for (const control of FORMAT_SPECS[format].controls) {
    base[control.key] = control.default
  }
  return base
}

const jobs = signal<BatchJob[]>([])
const targetFormat = signal<OutputFormat>('webp')
const settings = signal<Settings>(defaultSettings('webp'))
const maxLongEdge = signal(0)
const isDragging = signal(false)
const poolStats = signal(getPoolStats())
const newVersion = signal('')

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

const activeControls = computed(() => FORMAT_SPECS[targetFormat.value].controls)

// Keys capture everything that changes the encoded bytes except quality. Quality
// is excluded from `sampleKey` because the estimate curve already spans the
// quality range, so moving the quality slider needs no re-encode to re-estimate.
const sampleKey = computed(() => {
  const format = targetFormat.value
  const parts: string[] = [format]
  for (const control of FORMAT_SPECS[format].controls) {
    if (control.key === 'quality') continue
    parts.push(`${control.key}=${settings.value[control.key]}`)
  }
  if (maxLongEdge.value > 0) parts.push(`edge=${maxLongEdge.value}`)
  return parts.join('|')
})

const outputKey = computed(
  () => `${sampleKey.value}|quality=${settings.value.quality}`,
)

const isCurrent = (job: BatchJob) =>
  job.status === 'done' && job.outputKey === outputKey.value

const needsCompress = computed(() =>
  jobs.value.some(
    (job) =>
      job.status === 'estimated' ||
      (job.status === 'done' && job.outputKey !== outputKey.value),
  ),
)

const batchEstimate = computed(() =>
  jobs.value.reduce((sum, job) => {
    if (job.status === 'error') return sum
    if (isCurrent(job)) return sum + job.outputSize
    if (job.samples.length > 0 && job.sampleKey === sampleKey.value) {
      return sum + interpolate(job.samples, settings.value.quality)
    }
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

  const format = targetFormat.value
  const current = settings.value
  const edge = maxLongEdge.value
  const key = sampleKey.value

  updateJob(id, { status: 'estimating', error: '' })

  try {
    const buffer = await job.file.arrayBuffer()
    const { response } = processImage({
      fileBuffer: buffer,
      targetFormat: format,
      effort: current.effort,
      speed: current.speed,
      resize: edge > 0 ? { maxLongEdge: edge } : undefined,
      estimateOnly: true,
    })
    const result = await response
    if (jobTokens.get(id) !== token || result.type !== 'estimate') return

    updateJob(id, {
      status: 'estimated',
      samples: result.samples,
      width: result.width,
      height: result.height,
      outputSize: interpolate(result.samples, current.quality),
      sizeIsExact: false,
      sampleKey: key,
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

  const format = targetFormat.value
  const current = settings.value
  const edge = maxLongEdge.value
  const key = outputKey.value
  const samplesKey = sampleKey.value

  updateJob(id, { status: 'processing', error: '' })

  try {
    const buffer = await job.file.arrayBuffer()
    const { response } = processImage({
      fileBuffer: buffer,
      targetFormat: format,
      quality: current.quality,
      effort: current.effort,
      speed: current.speed,
      resize: edge > 0 ? { maxLongEdge: edge } : undefined,
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
      outputKey: key,
      sampleKey: samplesKey,
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
    outputExtension: FORMAT_SPECS[targetFormat.value].extension,
    outputSize: 0,
    sizeIsExact: false,
    outputKey: '',
    sampleKey: '',
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
  const key = outputKey.value
  const currentSampleKey = sampleKey.value
  jobs.value = jobs.value.map((job) => {
    if (job.samples.length === 0 || job.sampleKey !== currentSampleKey) {
      return job
    }
    const current = job.status === 'done' && job.outputKey === key
    return {
      ...job,
      outputSize: current
        ? job.outputSize
        : interpolate(job.samples, settings.value.quality),
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

function sampleInputsChanged() {
  if (jobs.value.length === 0) return
  if (batchMode.value) {
    for (const job of jobs.value) {
      if (job.status === 'error') continue
      void estimateJob(job.id)
    }
  } else {
    recompressSingle()
  }
}

function changeFormat(format: OutputFormat) {
  if (format === targetFormat.value) return
  targetFormat.value = format
  settings.value = defaultSettings(format)
  sampleInputsChanged()
}

function changeControl(key: ControlKey, value: number) {
  if (settings.value[key] === value) return
  settings.value = { ...settings.value, [key]: value }
  if (key === 'quality') {
    refreshEstimates()
    if (!batchMode.value) recompressSingle()
  } else {
    sampleInputsChanged()
  }
}

function changeResize(value: number) {
  const next = Number.isFinite(value) && value > 0 ? Math.round(value) : 0
  if (next === maxLongEdge.value) return
  maxLongEdge.value = next
  sampleInputsChanged()
}

function compressAll() {
  if (reprocessTimer) clearTimeout(reprocessTimer)
  for (const job of jobs.value) {
    if (job.status === 'error' || job.status === 'processing') continue
    if (job.status === 'estimated' || job.outputKey !== outputKey.value) {
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
      return isCurrent(job) ? '' : 'settings changed — re-compress'
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

  useEffect(() => {
    return watchForUpdates((version) => {
      newVersion.value = version
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
      {newVersion.value && (
        <div class="update-banner" role="status">
          <span>A new version is available.</span>
          <button
            type="button"
            class="button button--small"
            onClick={() => location.reload()}
          >
            Reload
          </button>
        </div>
      )}

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
          or click to choose files (JPEG, PNG, WebP, AVIF, JXL). Single images
          compress immediately; batches are estimated first.
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
              <span class="field__label">Output format</span>
              <select
                class="select"
                value={targetFormat.value}
                onChange={(event) =>
                  changeFormat(event.currentTarget.value as OutputFormat)
                }
              >
                {FORMAT_ORDER.map((format) => (
                  <option value={format} key={format}>
                    {FORMAT_SPECS[format].label}
                  </option>
                ))}
              </select>
            </label>

            {activeControls.value.map((control) => (
              <label class="field" key={control.key}>
                <span class="field__label">
                  {control.label}: {settings.value[control.key]}
                </span>
                <input
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={settings.value[control.key]}
                  onInput={(event) =>
                    changeControl(
                      control.key,
                      Number(event.currentTarget.value),
                    )
                  }
                />
                {control.hint && (
                  <span class="field__hint">{control.hint}</span>
                )}
              </label>
            ))}

            <label class="field">
              <span class="field__label">Resize — max long edge (px)</span>
              <input
                class="input"
                type="number"
                min={0}
                placeholder="original"
                value={maxLongEdge.value > 0 ? String(maxLongEdge.value) : ''}
                onChange={(event) =>
                  changeResize(Number(event.currentTarget.value))
                }
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
          Batch mode: change the settings as much as you like — sizes update
          from cached estimates instantly. Nothing is encoded until you press
          Compress.
        </p>
      )}

      <footer class="app__footer">v{appVersion}</footer>
    </main>
  )
}
