import { computed, effect, type Signal, signal } from '@preact/signals'
import type { JSX } from 'preact'
import { memo } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { JobStatus } from './lib/batchStats'
import {
  type ControlKey,
  FORMAT_ORDER,
  FORMAT_SPECS,
  type FormatControl,
  isHeavyFormat,
} from './lib/codecs/formats'
import { describeRenderer, preloadCodec } from './lib/codecs/registry'
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
import { validateFiles } from './lib/intake'
import { createJobStore } from './lib/jobStore'
import { disposeMetadataWorker, readDimensions } from './lib/metadataClient'
import { appVersion, watchForUpdates } from './lib/version'
import {
  computeWindow,
  DEFAULT_OVERSCAN,
  DEFAULT_ROW_GAP,
  DEFAULT_ROW_HEIGHT,
  listHeight,
  rowOffset,
} from './lib/virtual'
import {
  configureWorkers,
  disposePool,
  getPoolStats,
  processImage,
  subscribeToPool,
} from './lib/workerClient'
import {
  createStreamingZip,
  uniqueEntryName,
  ZipTooLargeError,
} from './lib/zip'

interface BatchJob {
  id: string
  name: string
  file: File
  originalSize: number
  status: JobStatus
  thumbnailUrl: string
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

// --- Signals -----------------------------------------------------------------
const targetFormat = signal<OutputFormat>('jpeg')
const settings = signal<Settings>(defaultSettings('jpeg'))
const maxLongEdge = signal(0)
const isDragging = signal(false)
const poolStats = signal(getPoolStats())
const renderer = signal('')
const newVersion = signal('')
const notice = signal('')
const zipping = signal(false)
const batchWarning = signal('')
const importing = signal(false)

// Ratios of estimated output to original size, averaged over the sampled
// images, used to extrapolate estimates for unmeasured rows in a big batch.
const averageRatios = signal<EstimateSample[]>([])
const sampledIds = signal<Set<string>>(new Set())

let idCounter = 0
let reprocessTimer: ReturnType<typeof setTimeout> | undefined
let sampleChangeTimer: ReturnType<typeof setTimeout> | undefined
const jobTokens = new Map<string, number>()
const estimateControllers = new Map<string, AbortController>()

const activeControls = computed(() => FORMAT_SPECS[targetFormat.value].controls)

const settingsWarning = computed(() => {
  const format = targetFormat.value
  const values = settings.value

  if (format === 'avif' && values.speed <= 6) {
    return 'AVIF at the Slow preset can take a very long time to process. Use Balanced or Fast for better performance.'
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

// --- Job store and incremental aggregates ------------------------------------
// Jobs live in a plain map (cheap full scans) plus a per-id signal so one
// completion re-renders only its row. Aggregates are maintained incrementally,
// so a single completion is O(1) instead of re-reducing the whole batch.
const jobStore = createJobStore<BatchJob>({
  getOutputKey: () => outputKey.value,
  toStats: (job) => ({
    status: job.status,
    originalSize: job.originalSize,
    outputSize: job.outputSize,
    outputKey: job.outputKey,
    hasBlob: job.outputBlob !== null,
  }),
})
const jobIds = jobStore.order
const stats = jobStore.stats

function getJob(id: string): BatchJob | undefined {
  return jobStore.get(id)
}

function listJobs(): BatchJob[] {
  return jobStore.list()
}

function raf(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback)
  }
  return setTimeout(callback, 16) as unknown as number
}

// The panel reads throttled counters so a burst of completions coalesces into
// at most one visual update per frame; logic reads `stats` directly.
function throttleSignal<T>(source: Signal<T>): Signal<T> {
  const output = signal(source.value)
  let frame = 0
  effect(() => {
    source.value
    if (frame) return
    frame = raf(() => {
      frame = 0
      output.value = source.value
    })
  })
  return output
}

const displayStats = throttleSignal(stats)

const total = computed(() => stats.value.total)
const batchMode = computed(() => stats.value.total > 1)
const finished = computed(() => displayStats.value.finished)
const failed = computed(() => displayStats.value.failed)
const originalTotal = computed(() => displayStats.value.originalBytes)
const progressPercent = computed(() => {
  const value = displayStats.value
  return value.total === 0
    ? 0
    : Math.round((value.finished / value.total) * 100)
})
const pendingEstimate = computed(() => displayStats.value.pending)
const estimatePhase = computed(
  () => batchMode.value && pendingEstimate.value > 0,
)
// The bar only reflects compression; estimates happen quietly in the
// background so the app looks ready to compress immediately.
const phasePercent = computed(() => progressPercent.value)
const phaseLabel = computed(
  () =>
    `${finished.value} / ${total.value} compressed${failed.value > 0 ? ` · ${failed.value} failed` : ''}`,
)

// Active/ready come straight from the incremental counters, so the Compress
// button and the busy state are correct without scanning the batch.
const needsCompress = computed(() => stats.value.active - stats.value.ready > 0)
const busy = computed(() => zipping.value || stats.value.processing > 0)

function estimateFor(job: BatchJob, quality: number): number {
  if (job.sampleKey !== sampleKey.value) return 0
  if (job.samples.length > 0) return interpolate(job.samples, quality)
  return deriveEstimate(job.originalSize, averageRatios.value, quality)
}

// Batch size estimate, rebuilt at most once per frame as jobs change.
const batchEstimate = signal(0)
let estimateFrame = 0
effect(() => {
  jobStore.revision.value
  if (estimateFrame) return
  estimateFrame = raf(() => {
    estimateFrame = 0
    const key = outputKey.value
    const quality = settings.value.quality
    let sum = 0
    for (const job of listJobs()) {
      if (job.status === 'error') continue
      if (job.status === 'done' && job.outputKey === key) sum += job.outputSize
      else sum += estimateFor(job, quality)
    }
    batchEstimate.value = sum
  })
})

const readyDownloadable = computed(() => displayStats.value.readyDownloadable)
const canDownloadAll = computed(
  () => total.value > 1 && readyDownloadable.value > 0,
)

function downloadableList(): BatchJob[] {
  const key = outputKey.value
  return listJobs().filter(
    (job) => job.status === 'done' && job.outputKey === key && job.outputBlob,
  )
}

function nextToken(id: string): number {
  const token = (jobTokens.get(id) ?? 0) + 1
  jobTokens.set(id, token)
  return token
}

// --- Job mutations -----------------------------------------------------------
function addJobs(jobs: BatchJob[]) {
  jobStore.add(jobs)
}

function updateJob(id: string, patch: Partial<BatchJob>) {
  jobStore.update(id, patch)
}

function dropJob(id: string) {
  jobStore.remove(id)
}

function clearJobs() {
  jobStore.clear()
}

function applyWorkerBudget() {
  const base = getDeviceProfile().workerCount
  const format = targetFormat.value
  const heavy = isHeavyFormat(format, settings.value.mode)
  configureWorkers(heavy ? heavyWorkerCount(base) : base)
}

let rendererToken = 0

async function refreshRenderer() {
  const token = ++rendererToken
  const label = await describeRenderer(targetFormat.value, settings.value.mode)
  if (token === rendererToken) renderer.value = label
}

let idleTeardownTimer: ReturnType<typeof setTimeout> | undefined

function cancelIdleTeardown() {
  if (idleTeardownTimer) {
    clearTimeout(idleTeardownTimer)
    idleTeardownTimer = undefined
  }
}

/**
 * Terminates the worker pool (and metadata worker) a short while after all
 * encoding stops. Idle workers keep their WASM heaps and decoded canvases
 * alive, which leaves the tab bloated until a reload. The pool is recreated
 * lazily on the next job.
 */
function scheduleIdleTeardown() {
  cancelIdleTeardown()
  idleTeardownTimer = setTimeout(() => {
    idleTeardownTimer = undefined
    const active = stats.value.pending + stats.value.processing > 0
    if (active || zipping.value) return
    disposePool()
    disposeMetadataWorker()
  }, 2000)
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
  const curves = listJobs()
    .filter(
      (job) => job.samples.length > 0 && job.sampleKey === sampleKey.value,
    )
    .map((job) => ({ samples: job.samples, originalSize: job.originalSize }))
  averageRatios.value = averageRatioSamples(curves)
}

function refreshEstimates() {
  const key = outputKey.value
  const quality = settings.value.quality
  for (const id of jobIds.value) {
    const job = getJob(id)
    if (!job || job.status === 'error') continue
    if (job.status === 'done' && job.outputKey === key) continue
    const estimate = estimateFor(job, quality)
    if (estimate === 0) continue
    updateJob(id, { outputSize: estimate, sizeIsExact: false })
  }
}

async function estimateJob(id: string) {
  cancelIdleTeardown()
  const token = nextToken(id)
  const job = getJob(id)
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
      quality: current.quality,
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

    const previousThumb = job.thumbnailUrl
    const thumbnailUrl = URL.createObjectURL(result.thumbnailBlob)
    updateJob(id, {
      status: 'estimated',
      thumbnailUrl,
      samples: result.samples,
      outputSize: interpolate(result.samples, current.quality),
      sizeIsExact: false,
      sampleKey: key,
    })
    if (previousThumb) URL.revokeObjectURL(previousThumb)
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
    scheduleIdleTeardown()
  }
}

async function compressJob(id: string) {
  cancelIdleTeardown()
  const token = nextToken(id)
  const job = getJob(id)
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
      consumeInput: true,
      priority: 'high',
    })
    const result = await response
    if (jobTokens.get(id) !== token || result.type !== 'result') return

    const previousThumb = job.thumbnailUrl
    const thumbnailUrl = URL.createObjectURL(result.thumbnailBlob)
    updateJob(id, {
      status: 'done',
      thumbnailUrl,
      outputBlob: result.outputBlob,
      outputExtension: result.extension,
      outputSize: result.outputSize,
      sizeIsExact: true,
      outputKey: key,
      sampleKey: samplesKey,
    })
    if (previousThumb) URL.revokeObjectURL(previousThumb)
  } catch (error) {
    if (jobTokens.get(id) !== token) return
    updateJob(id, {
      status: 'error',
      error: error instanceof Error ? error.message : 'Conversion failed',
    })
  } finally {
    releaseFileBuffer(id)
    scheduleIdleTeardown()
  }
}

function updateSampling(): Set<string> {
  const ids = jobIds.value.filter((id) => getJob(id)?.status !== 'error')
  const limit = sampleSize(
    ids.length,
    isHeavyFormat(targetFormat.value, settings.value.mode),
  )
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

function batchRiskWarning(count: number, bytes: number): string {
  const profile = getDeviceProfile()
  if (bytes > profile.maxZipBytes) {
    return `This batch is ${formatBytes(bytes)} — above the ${formatBytes(profile.maxZipBytes)} archive budget for this device. Large batches may exhaust memory.`
  }
  if (count > 1000) {
    return `Large batch (${count} files). Processing runs in waves; the list stays usable while it works.`
  }
  return ''
}

async function addFiles(fileList: FileList | File[] | null) {
  if (!fileList) return
  const incoming = Array.from(fileList)
  if (incoming.length === 0) return

  importing.value = true
  batchWarning.value = ''
  notice.value = ''
  try {
    const { accepted, rejected } = await validateFiles(incoming)
    if (rejected.length > 0) {
      const listed = rejected
        .slice(0, 3)
        .map((entry) => entry.name)
        .join(', ')
      const extra =
        rejected.length > 3 ? ` and ${rejected.length - 3} more` : ''
      notice.value = `Skipped ${rejected.length} unsupported file${rejected.length === 1 ? '' : 's'}: ${listed}${extra}. Supported inputs are JPEG, PNG, WebP, and AVIF.`
    }
    if (accepted.length === 0) return

    const created: BatchJob[] = accepted.map((file) => ({
      id: `file-${++idCounter}`,
      name: file.name,
      file,
      originalSize: file.size,
      status: 'queued',
      thumbnailUrl: '',
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

    // One transaction for the whole drop: the id array and aggregates update
    // once instead of growing by copy per file.
    addJobs(created)
    const bytes = created.reduce((sum, job) => sum + job.originalSize, 0)
    batchWarning.value = batchRiskWarning(created.length, bytes)

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
      if (jobIds.value.length > 1) {
        if (sampled.has(job.id)) void estimateJob(job.id)
        else
          updateJob(job.id, { status: 'estimated', sampleKey: sampleKey.value })
      } else {
        void compressJob(job.id)
      }
    }
  } finally {
    importing.value = false
  }
}

function recompressSingle() {
  cancelAllEstimates()
  if (reprocessTimer) clearTimeout(reprocessTimer)
  reprocessTimer = setTimeout(() => {
    for (const id of jobIds.value) {
      if (getJob(id)?.status === 'error') continue
      void compressJob(id)
    }
  }, 200)
}

function scheduleSampleReestimate() {
  if (jobIds.value.length === 0) return
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
    for (const id of jobIds.value) {
      const job = getJob(id)
      if (!job || job.status === 'error') continue
      const measured = sampled.has(id)
      updateJob(id, {
        status: measured ? 'estimating' : 'estimated',
        samples: [],
        outputSize: 0,
        sizeIsExact: false,
        sampleKey: measured ? '' : key,
      })
    }
    averageRatios.value = []
    for (const id of jobIds.value) {
      if (sampled.has(id)) void estimateJob(id)
    }
  }, 200)
}

function changeFormat(format: OutputFormat) {
  if (busy.value || format === targetFormat.value) return
  // Drop the current workers so the previous codec's WASM heap/canvases are
  // released before we warm and use the new format.
  cancelIdleTeardown()
  disposePool()
  targetFormat.value = format
  settings.value = defaultSettings(format)
  jobStore.refreshReady()
  applyWorkerBudget()
  void refreshRenderer()
  // Warm the WASM codec while the user dials in settings, so selecting AVIF
  // does not stall on the first encode.
  if (format === 'avif') void preloadCodec(format)
  scheduleSampleReestimate()
}

function changeControl(key: ControlKey, value: number) {
  if (busy.value || settings.value[key] === value) return
  settings.value = { ...settings.value, [key]: value }
  jobStore.refreshReady()
  if (key === 'quality') {
    // Heavy codecs estimate only the current quality, so a quality change needs
    // a fresh (debounced) estimate; light codecs interpolate from the curve.
    if (isHeavyFormat(targetFormat.value, settings.value.mode)) {
      scheduleSampleReestimate()
    } else {
      refreshEstimates()
      if (!batchMode.value) recompressSingle()
    }
  } else {
    applyWorkerBudget()
    void refreshRenderer()
    scheduleSampleReestimate()
  }
}

function changeResize(value: number) {
  if (busy.value) return
  const next = Number.isFinite(value) && value > 0 ? Math.round(value) : 0
  if (next === maxLongEdge.value) return
  maxLongEdge.value = next
  jobStore.refreshReady()
  scheduleSampleReestimate()
}

function compressAll() {
  if (busy.value) return
  cancelAllEstimates()
  if (reprocessTimer) clearTimeout(reprocessTimer)
  for (const id of jobIds.value) {
    const job = getJob(id)
    if (!job || job.status === 'error' || job.status === 'processing') continue
    if (job.status === 'estimated' || job.outputKey !== outputKey.value) {
      void compressJob(id)
    }
  }
}

function removeJob(id: string) {
  cancelEstimate(id)
  nextToken(id)
  forgetFile(id)
  const job = getJob(id)
  if (job?.thumbnailUrl) URL.revokeObjectURL(job.thumbnailUrl)
  dropJob(id)
  scheduleIdleTeardown()
}

function clearAll() {
  if (reprocessTimer) clearTimeout(reprocessTimer)
  if (sampleChangeTimer) clearTimeout(sampleChangeTimer)
  cancelAllEstimates()
  for (const job of listJobs()) {
    nextToken(job.id)
    forgetFile(job.id)
    if (job.thumbnailUrl) URL.revokeObjectURL(job.thumbnailUrl)
  }
  clearJobs()
  averageRatios.value = []
  sampledIds.value = new Set()
  notice.value = ''
  cancelIdleTeardown()
  disposePool()
  disposeMetadataWorker()
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

// The full-resolution output URL is only materialized on demand, so rows never
// hold (or decode) a multi-megapixel blob.
function downloadJob(job: BatchJob) {
  if (!job.outputBlob) return
  triggerDownload(
    job.outputBlob,
    replaceExtension(job.name, job.outputExtension),
  )
}

async function downloadAll() {
  if (zipping.value) return
  const list = downloadableList()
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
    for (const job of downloadableList()) {
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
    case 'estimating':
      return ''
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

// Reads poolStats/renderer itself so frequent pool notifications re-render only
// this meter, not the whole job list.
function PoolMeter() {
  return (
    <span class="panel__value" title="Encoder backend and worker pool">
      {renderer.value ? `${renderer.value} · ` : ''}workers{' '}
      {poolStats.value.busy}/{poolStats.value.size}
    </span>
  )
}

interface JobRowProps {
  id: string
  index: number
  setSize: number
  top: number
  onRemove: (id: string) => void
  onDownload: (job: BatchJob) => void
}

// Reads its own job signal, so a completion re-renders only this row. Memoized
// on stable props so scrolling and list changes skip unchanged rows.
const JobRow = memo(function JobRow({
  id,
  index,
  setSize,
  top,
  onRemove,
  onDownload,
}: JobRowProps) {
  const job = jobStore.signalFor(id)?.value
  if (!job) return null
  const current = isCurrent(job)
  const label = statusLabel(job)
  const isBusy = busy.value
  return (
    <li
      class="job"
      style={{ top: `${top}px`, height: `${DEFAULT_ROW_HEIGHT}px` }}
      aria-posinset={index + 1}
      aria-setsize={setSize}
    >
      <div class="job__thumb">
        {job.status === 'processing' ? (
          <span class="job__spinner" />
        ) : job.status === 'error' ? (
          <span class="job__icon job__icon--error">!</span>
        ) : job.thumbnailUrl ? (
          <img
            class={current ? '' : 'job__thumb--stale'}
            src={job.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
          />
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
        {current && job.outputBlob ? (
          <button
            type="button"
            class="button button--small"
            disabled={isBusy}
            onClick={() => onDownload(job)}
          >
            Download
          </button>
        ) : null}
        <button
          type="button"
          class="icon-button"
          title="Remove"
          aria-label={`Remove ${job.name}`}
          disabled={isBusy}
          onClick={() => onRemove(job.id)}
        >
          ×
        </button>
      </div>
    </li>
  )
})

// Virtualized to the visible rows plus a small overscan window. Reads only
// `jobIds` for order, so completions never re-render the list container.
function JobList() {
  const ids = jobIds.value
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const frameRef = useRef(0)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const update = () => setViewportHeight(element.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const onScroll = () => {
    const element = scrollRef.current
    if (!element || frameRef.current) return
    frameRef.current = raf(() => {
      frameRef.current = 0
      setScrollTop(element.scrollTop)
    })
  }

  const { start, end } = computeWindow({
    count: ids.length,
    rowHeight: DEFAULT_ROW_HEIGHT,
    gap: DEFAULT_ROW_GAP,
    viewportHeight: viewportHeight || DEFAULT_ROW_HEIGHT * 8,
    scrollTop,
    overscan: DEFAULT_OVERSCAN,
  })
  const height = listHeight(ids.length, DEFAULT_ROW_HEIGHT, DEFAULT_ROW_GAP)
  const visible = ids.slice(start, end)

  return (
    <div class="queue" ref={scrollRef} onScroll={onScroll}>
      <ul class="jobs" style={{ height: `${height}px` }}>
        {visible.map((id, offset) => {
          const index = start + offset
          return (
            <JobRow
              key={id}
              id={id}
              index={index}
              setSize={ids.length}
              top={rowOffset(index, DEFAULT_ROW_HEIGHT, DEFAULT_ROW_GAP)}
              onRemove={removeJob}
              onDownload={downloadJob}
            />
          )
        })}
      </ul>
    </div>
  )
}

// The panel reads the aggregate computeds, isolating those re-renders from the
// list and the app shell.
function Panel({ onAddImages }: { onAddImages: () => void }) {
  return (
    <section class="panel">
      <label class="field">
        <span class="field__label">Output format</span>
        <select
          class="select"
          value={targetFormat.value}
          disabled={busy.value}
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
            {control.kind === 'range' ? `: ${settings.value[control.key]}` : ''}
          </span>
          {control.kind === 'range' ? (
            <input
              type="range"
              aria-label={control.label}
              min={control.min}
              max={control.max}
              step={control.step}
              value={settings.value[control.key]}
              disabled={busy.value}
              onInput={(event) =>
                changeControl(control.key, Number(event.currentTarget.value))
              }
            />
          ) : (
            <select
              class="select"
              aria-label={control.label}
              value={String(settings.value[control.key])}
              disabled={busy.value}
              onChange={(event) =>
                changeControl(control.key, Number(event.currentTarget.value))
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
          disabled={busy.value}
          onChange={(event) => changeResize(Number(event.currentTarget.value))}
        />
      </label>

      <div class="panel__row">
        <span class="panel__label">
          {importing.value
            ? 'Checking files…'
            : `${total.value} file${total.value === 1 ? '' : 's'}`}
        </span>
        <span class="panel__value">
          {formatBytes(originalTotal.value)} input
        </span>
      </div>

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

      {batchWarning.value && (
        <p class="field__warning" role="alert">
          {batchWarning.value}
        </p>
      )}

      <div class="panel__row">
        <span class="panel__label">{phaseLabel.value}</span>
        <PoolMeter />
      </div>

      {batchMode.value && total.value > 0 && (
        <div class="panel__row">
          <span class="panel__label">Estimated file size</span>
          <span class="panel__value">
            {estimatePhase.value ? (
              'Calculating…'
            ) : (
              <>
                {needsCompress.value ? '~' : ''}
                {formatBytes(batchEstimate.value)}
                {originalTotal.value > 0
                  ? ` (${savingsLabel(originalTotal.value, batchEstimate.value)})`
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
          disabled={busy.value}
          onClick={compressAll}
        >
          Compress {total.value > 1 ? `all ${total.value} images` : 'image'}
        </button>
      )}

      <div class="panel__actions">
        <button
          type="button"
          class="button"
          disabled={busy.value}
          onClick={onAddImages}
        >
          Add images
        </button>

        {canDownloadAll.value && (
          <button
            type="button"
            class="button button--primary"
            onClick={downloadAll}
            disabled={zipping.value || busy.value}
          >
            {zipping.value
              ? 'Building zip…'
              : `Download all (${readyDownloadable.value}) as zip`}
          </button>
        )}

        {canDownloadAll.value && supportsDirectoryPicker && (
          <button
            type="button"
            class="button"
            disabled={busy.value}
            onClick={saveToFolder}
          >
            Save to folder…
          </button>
        )}

        <button
          type="button"
          class="button"
          disabled={busy.value}
          onClick={clearAll}
        >
          Clear all
        </button>
      </div>
    </section>
  )
}

export function App() {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    applyWorkerBudget()
    configureFileBufferCap(Math.floor(getDeviceProfile().maxZipBytes / 4))
    void refreshRenderer()
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
    void addFiles(event.currentTarget.files)
    event.currentTarget.value = ''
  }

  function onDrop(event: JSX.TargetedDragEvent<HTMLElement>) {
    event.preventDefault()
    isDragging.value = false
    void addFiles(event.dataTransfer?.files ?? null)
  }

  function onDragOver(event: JSX.TargetedDragEvent<HTMLElement>) {
    event.preventDefault()
    isDragging.value = true
  }

  const jobCount = jobIds.value.length

  return (
    <main
      class="app"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => {
        isDragging.value = false
      }}
    >
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

      {importing.value && (
        <div class="update-banner" role="status">
          <span>Checking files…</span>
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

      {jobCount === 0 && (
        <button
          type="button"
          class={`dropzone${isDragging.value ? ' dropzone--active' : ''}`}
          onClick={() => inputRef.current?.click()}
        >
          <span class="dropzone__title">Drop images here</span>
          <span class="dropzone__hint">
            or click to choose files (JPEG, PNG, WebP, AVIF). Single images
            compress immediately; batches are estimated first.
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        class="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={onInputChange}
      />

      {jobCount > 0 && (
        <>
          <Panel onAddImages={() => inputRef.current?.click()} />
          <JobList />
        </>
      )}

      {jobCount > 0 && batchMode.value && (
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
