import { computed, signal } from '@preact/signals'
import type { JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import {
  type ControlKey,
  FORMAT_ORDER,
  FORMAT_SPECS,
  type FormatControl,
} from './lib/codecs/formats'
import { preloadCodec } from './lib/codecs/registry'
import type { OutputFormat } from './lib/codecs/types'
import { getDeviceProfile, heavyWorkerCount } from './lib/device'
import {
  averageRatioSamples,
  deriveEstimate,
  type EstimateSample,
  interpolate,
  sampleSize,
} from './lib/estimate'
import {
  acquireFileBuffer,
  configureFileBufferCap,
  forgetFile,
  registerFile,
  releaseFileBuffer,
} from './lib/fileBufferStore'
import { formatBytes, percentReduction, replaceExtension } from './lib/format'
import { readDimensions } from './lib/metadataClient'
import { appVersion, watchForUpdates } from './lib/version'
import {
  configureWorkers,
  getPoolStats,
  processImage,
  subscribeToPool,
} from './lib/workerClient'
import {
  createStreamingZip,
  uniqueEntryName,
  ZipTooLargeError,
} from './lib/zip'

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
  outputBlob: Blob | null
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
  mode: number
}

interface WritableFileHandle {
  createWritable(): Promise<{
    write(data: BlobPart): Promise<void>
    close(): Promise<void>
  }>
}

interface DirectoryHandle {
  getFileHandle(
    name: string,
    options: { create: boolean },
  ): Promise<WritableFileHandle>
}

interface WindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: () => Promise<DirectoryHandle>
}

const directoryPicker =
  typeof window === 'undefined'
    ? undefined
    : (window as WindowWithDirectoryPicker).showDirectoryPicker

const supportsDirectoryPicker = typeof directoryPicker === 'function'

function defaultSettings(format: OutputFormat): Settings {
  const base: Settings = { quality: 75, effort: 2, speed: 6, mode: 0 }
  for (const control of FORMAT_SPECS[format].controls) {
    base[control.key] = control.default
  }
  return base
}

function controlHint(control: FormatControl, value: number): string {
  if (control.kind === 'select') {
    return (
      control.options.find((option) => option.value === value)?.hint ??
      control.hint ??
      ''
    )
  }
  return control.hint ?? ''
}

const jobs = signal<BatchJob[]>([])
const targetFormat = signal<OutputFormat>('jpeg')
const settings = signal<Settings>(defaultSettings('jpeg'))
const maxLongEdge = signal(0)
const isDragging = signal(false)
const poolStats = signal(getPoolStats())
const newVersion = signal('')
const notice = signal('')
const zipping = signal(false)

// Ratios of estimated output to original size, averaged over the sampled
// images, used to extrapolate estimates for unmeasured rows in a big batch.
const averageRatios = signal<EstimateSample[]>([])
const sampledIds = signal<Set<string>>(new Set())

let idCounter = 0
let reprocessTimer: ReturnType<typeof setTimeout> | undefined
let sampleChangeTimer: ReturnType<typeof setTimeout> | undefined
const jobTokens = new Map<string, number>()
const estimateControllers = new Map<string, AbortController>()

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

const settingsWarning = computed(() => {
  const format = targetFormat.value
  const values = settings.value

  if (total.value > 5 && format === 'avif' && values.speed <= 6) {
    return 'AVIF below speed 7 can take a very long time and may hit memory errors on large batches. Use speed 7 or higher for big batches.'
  }
  if (total.value > 5 && format === 'jxl' && values.quality >= 90) {
    return 'High JPEG XL quality can take a very long time and may hit memory errors on large batches. Lower the quality for big batches.'
  }
  const heavy =
    format === 'avif' ||
    format === 'jxl' ||
    (format === 'png' && values.mode === 2)
  if (total.value > 50 && heavy) {
    return 'Large batches of this format can use a lot of memory. Consider compressing in smaller groups.'
  }
  return ''
})

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

function estimateFor(job: BatchJob, quality: number): number {
  if (job.sampleKey !== sampleKey.value) return 0
  if (job.samples.length > 0) return interpolate(job.samples, quality)
  return deriveEstimate(job.originalSize, averageRatios.value, quality)
}

const batchEstimate = computed(() =>
  jobs.value.reduce((sum, job) => {
    if (job.status === 'error') return sum
    if (isCurrent(job)) return sum + job.outputSize
    return sum + estimateFor(job, settings.value.quality)
  }, 0),
)

const downloadable = computed(() =>
  jobs.value.filter(
    (job) => job.status === 'done' && isCurrent(job) && job.outputBlob,
  ),
)
const canDownloadAll = computed(
  () => jobs.value.length > 1 && downloadable.value.length > 0,
)

function nextToken(id: string): number {
  const token = (jobTokens.get(id) ?? 0) + 1
  jobTokens.set(id, token)
  return token
}

let pendingPatches = new Map<string, Partial<BatchJob>>()
let flushHandle: number | null = null

// Coalesces per-result job updates so a burst of worker completions causes one
// render per frame instead of N full-list renders.
function flushJobPatches() {
  if (flushHandle !== null) {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(flushHandle)
    } else {
      clearTimeout(flushHandle)
    }
    flushHandle = null
  }
  if (pendingPatches.size === 0) return
  const patches = pendingPatches
  pendingPatches = new Map()
  jobs.value = jobs.value.map((job) => {
    const patch = patches.get(job.id)
    return patch ? { ...job, ...patch } : job
  })
}

function updateJob(id: string, patch: Partial<BatchJob>) {
  pendingPatches.set(id, { ...pendingPatches.get(id), ...patch })
  if (flushHandle !== null) return
  const run = () => {
    flushHandle = null
    flushJobPatches()
  }
  flushHandle =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(run)
      : (setTimeout(run, 0) as unknown as number)
}

function applyWorkerBudget() {
  const base = getDeviceProfile().workerCount
  const format = targetFormat.value
  const heavy =
    format === 'avif' ||
    format === 'jxl' ||
    (format === 'png' && settings.value.mode === 2)
  configureWorkers(heavy ? heavyWorkerCount(base) : base)
}

function cancelEstimate(id: string) {
  estimateControllers.get(id)?.abort()
  estimateControllers.delete(id)
}

function cancelAllEstimates() {
  for (const controller of estimateControllers.values()) controller.abort()
  estimateControllers.clear()
}

function updateAverageRatios() {
  flushJobPatches()
  const curves = jobs.value
    .filter(
      (job) => job.samples.length > 0 && job.sampleKey === sampleKey.value,
    )
    .map((job) => ({ samples: job.samples, originalSize: job.originalSize }))
  averageRatios.value = averageRatioSamples(curves)
}

function refreshEstimates() {
  flushJobPatches()
  const key = outputKey.value
  const quality = settings.value.quality
  jobs.value = jobs.value.map((job) => {
    if (job.status === 'error') return job
    if (job.status === 'done' && job.outputKey === key) return job
    const estimate = estimateFor(job, quality)
    if (estimate === 0) return job
    return { ...job, outputSize: estimate, sizeIsExact: false }
  })
}

async function estimateJob(id: string) {
  flushJobPatches()
  const token = nextToken(id)
  const job = jobs.value.find((candidate) => candidate.id === id)
  if (!job) return

  cancelEstimate(id)
  const controller = new AbortController()
  estimateControllers.set(id, controller)

  const format = targetFormat.value
  const current = settings.value
  const edge = maxLongEdge.value
  const key = sampleKey.value

  updateJob(id, { status: 'estimating', error: '', sampleKey: key })

  try {
    const { response } = processImage({
      readFile: (consume) => acquireFileBuffer(id, consume),
      targetFormat: format,
      effort: current.effort,
      speed: current.speed,
      mode: current.mode,
      resize: edge > 0 ? { maxLongEdge: edge } : undefined,
      estimateOnly: true,
      priority: 'low',
      signal: controller.signal,
    })
    const result = await response
    if (jobTokens.get(id) !== token || result.type !== 'estimate') return

    updateJob(id, {
      status: 'estimated',
      samples: result.samples,
      outputSize: interpolate(result.samples, current.quality),
      sizeIsExact: false,
      sampleKey: key,
    })
    updateAverageRatios()
    refreshEstimates()
  } catch (error) {
    if (controller.signal.aborted || jobTokens.get(id) !== token) return
    updateJob(id, {
      status: 'error',
      error: error instanceof Error ? error.message : 'Conversion failed',
    })
  } finally {
    if (estimateControllers.get(id) === controller) {
      estimateControllers.delete(id)
    }
  }
}

async function compressJob(id: string) {
  flushJobPatches()
  const token = nextToken(id)
  const job = jobs.value.find((candidate) => candidate.id === id)
  if (!job) return

  cancelEstimate(id)

  const format = targetFormat.value
  const current = settings.value
  const edge = maxLongEdge.value
  const key = outputKey.value
  const samplesKey = sampleKey.value

  updateJob(id, { status: 'processing', error: '' })

  try {
    const { response } = processImage({
      readFile: (consume) => acquireFileBuffer(id, consume),
      targetFormat: format,
      quality: current.quality,
      effort: current.effort,
      speed: current.speed,
      mode: current.mode,
      resize: edge > 0 ? { maxLongEdge: edge } : undefined,
      buildEstimate: false,
      consumeInput: true,
      priority: 'high',
    })
    const result = await response
    if (jobTokens.get(id) !== token || result.type !== 'result') return

    const previousUrl = job.outputUrl
    const blob = result.outputBlob
    const url = URL.createObjectURL(blob)
    updateJob(id, {
      status: 'done',
      outputUrl: url,
      outputBlob: blob,
      outputExtension: result.extension,
      outputSize: result.outputSize,
      sizeIsExact: true,
      outputKey: key,
      sampleKey: samplesKey,
      ...(result.samples ? { samples: result.samples } : {}),
    })
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    if (result.samples) {
      updateAverageRatios()
      refreshEstimates()
    }
  } catch (error) {
    if (jobTokens.get(id) !== token) return
    updateJob(id, {
      status: 'error',
      error: error instanceof Error ? error.message : 'Conversion failed',
    })
  } finally {
    releaseFileBuffer(id)
  }
}

function updateSampling(): Set<string> {
  flushJobPatches()
  const ids = jobs.value
    .filter((job) => job.status !== 'error')
    .map((job) => job.id)
  const limit = sampleSize(ids.length)
  const existing = new Set(
    [...sampledIds.value].filter((id) => ids.includes(id)),
  )
  if (existing.size >= limit) {
    sampledIds.value = existing
    return existing
  }

  const candidates = ids.filter((id) => !existing.has(id))
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  for (const id of candidates) {
    if (existing.size >= limit) break
    existing.add(id)
  }

  sampledIds.value = existing
  return existing
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
    outputBlob: null,
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
  const sampled = updateSampling()

  for (const job of created) {
    registerFile(job.id, job.file)
    void readDimensions(job.file).then((dimensions) => {
      if (dimensions) {
        updateJob(job.id, {
          width: dimensions.width,
          height: dimensions.height,
        })
      }
    })

    // A lone image is compressed right away; a batch is only estimated (a
    // bounded sample for large batches) so settings can be dialled in first.
    if (jobs.value.length > 1) {
      if (sampled.has(job.id)) void estimateJob(job.id)
      else
        updateJob(job.id, { status: 'estimated', sampleKey: sampleKey.value })
    } else {
      void compressJob(job.id)
    }
  }
}

function recompressSingle() {
  cancelAllEstimates()
  if (reprocessTimer) clearTimeout(reprocessTimer)
  reprocessTimer = setTimeout(() => {
    for (const job of jobs.value) {
      if (job.status === 'error') continue
      void compressJob(job.id)
    }
  }, 200)
}

function scheduleSampleReestimate() {
  if (jobs.value.length === 0) return
  if (sampleChangeTimer) clearTimeout(sampleChangeTimer)
  sampleChangeTimer = setTimeout(() => {
    sampleChangeTimer = undefined
    if (!batchMode.value) {
      recompressSingle()
      return
    }

    cancelAllEstimates()
    const sampled = updateSampling()
    const key = sampleKey.value
    jobs.value = jobs.value.map((job) => {
      if (job.status === 'error') return job
      const measured = sampled.has(job.id)
      return {
        ...job,
        status: measured ? 'estimating' : 'estimated',
        samples: [],
        outputSize: 0,
        sizeIsExact: false,
        sampleKey: measured ? '' : key,
      }
    })
    averageRatios.value = []
    for (const job of jobs.value) {
      if (sampled.has(job.id)) void estimateJob(job.id)
    }
  }, 200)
}

function changeFormat(format: OutputFormat) {
  if (format === targetFormat.value) return
  targetFormat.value = format
  settings.value = defaultSettings(format)
  applyWorkerBudget()
  // Warm the WASM codec while the user dials in settings, so selecting
  // AVIF/JXL does not stall on the first encode.
  if (format === 'avif' || format === 'jxl') void preloadCodec(format)
  scheduleSampleReestimate()
}

function changeControl(key: ControlKey, value: number) {
  if (settings.value[key] === value) return
  settings.value = { ...settings.value, [key]: value }
  if (key === 'quality') {
    refreshEstimates()
    if (!batchMode.value) recompressSingle()
  } else {
    applyWorkerBudget()
    scheduleSampleReestimate()
  }
}

function changeResize(value: number) {
  const next = Number.isFinite(value) && value > 0 ? Math.round(value) : 0
  if (next === maxLongEdge.value) return
  maxLongEdge.value = next
  scheduleSampleReestimate()
}

function compressAll() {
  cancelAllEstimates()
  if (reprocessTimer) clearTimeout(reprocessTimer)
  for (const job of jobs.value) {
    if (job.status === 'error' || job.status === 'processing') continue
    if (job.status === 'estimated' || job.outputKey !== outputKey.value) {
      void compressJob(job.id)
    }
  }
}

function removeJob(id: string) {
  cancelEstimate(id)
  nextToken(id)
  forgetFile(id)
  const job = jobs.value.find((candidate) => candidate.id === id)
  if (job?.outputUrl) URL.revokeObjectURL(job.outputUrl)
  jobs.value = jobs.value.filter((candidate) => candidate.id !== id)
}

function clearAll() {
  if (reprocessTimer) clearTimeout(reprocessTimer)
  if (sampleChangeTimer) clearTimeout(sampleChangeTimer)
  cancelAllEstimates()
  for (const job of jobs.value) {
    nextToken(job.id)
    forgetFile(job.id)
    if (job.outputUrl) URL.revokeObjectURL(job.outputUrl)
  }
  jobs.value = []
  averageRatios.value = []
  sampledIds.value = new Set()
  notice.value = ''
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

async function downloadAll() {
  if (zipping.value) return
  const list = downloadable.value
  if (list.length === 0) return

  zipping.value = true
  notice.value = ''
  try {
    const zip = await createStreamingZip(getDeviceProfile().maxZipBytes)
    const used = new Set<string>()
    for (const job of list) {
      if (!job.outputBlob) continue
      const name = uniqueEntryName(
        replaceExtension(job.name, job.outputExtension),
        used,
      )
      await zip.add(name, job.outputBlob)
    }
    const blob = await zip.finish()
    triggerDownload(blob, 'images.zip')
  } catch (error) {
    notice.value =
      error instanceof ZipTooLargeError
        ? error.message
        : 'Could not build the zip.'
  } finally {
    zipping.value = false
  }
}

async function saveToFolder() {
  if (!directoryPicker) return
  try {
    const directory = await directoryPicker()
    const used = new Set<string>()
    for (const job of downloadable.value) {
      if (!job.outputBlob) continue
      const name = uniqueEntryName(
        replaceExtension(job.name, job.outputExtension),
        used,
      )
      const handle = await directory.getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      await writable.write(job.outputBlob)
      await writable.close()
    }
  } catch (error) {
    // The user dismissing the picker is not an error worth surfacing.
    if (error instanceof DOMException && error.name === 'AbortError') return
    throw error
  }
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
    applyWorkerBudget()
    configureFileBufferCap(Math.floor(getDeviceProfile().maxZipBytes / 4))
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

      {notice.value && (
        <div class="update-banner" role="status">
          <span>{notice.value}</span>
          <button
            type="button"
            class="button button--small"
            onClick={() => {
              notice.value = ''
            }}
          >
            Dismiss
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
              <div class="field" key={control.key}>
                <span class="field__label">
                  {control.label}
                  {control.kind === 'range'
                    ? `: ${settings.value[control.key]}`
                    : ''}
                </span>
                {control.kind === 'range' ? (
                  <input
                    type="range"
                    aria-label={control.label}
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
                ) : (
                  <select
                    class="select"
                    aria-label={control.label}
                    value={String(settings.value[control.key])}
                    onChange={(event) =>
                      changeControl(
                        control.key,
                        Number(event.currentTarget.value),
                      )
                    }
                  >
                    {control.options.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
                {controlHint(control, settings.value[control.key]) && (
                  <span class="field__hint">
                    {controlHint(control, settings.value[control.key])}
                  </span>
                )}
              </div>
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

            {settingsWarning.value && (
              <p class="field__warning" role="alert">
                {settingsWarning.value}
              </p>
            )}

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

            <div class="panel__actions">
              {canDownloadAll.value && (
                <button
                  type="button"
                  class="button button--primary"
                  onClick={downloadAll}
                  disabled={zipping.value}
                >
                  {zipping.value
                    ? 'Building zip…'
                    : `Download all (${downloadable.value.length}) as zip`}
                </button>
              )}

              {canDownloadAll.value && supportsDirectoryPicker && (
                <button type="button" class="button" onClick={saveToFolder}>
                  Save to folder…
                </button>
              )}

              <button type="button" class="button" onClick={clearAll}>
                Clear all
              </button>
            </div>
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
                      {job.width > 0 && `${job.width}×${job.height}px · `}
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
