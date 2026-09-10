import { computed, signal } from '@preact/signals'
import type { JSX } from 'preact'
import { useRef } from 'preact/hooks'
import { type EstimateSample, interpolate } from './lib/estimate'
import { formatBytes, percentReduction, replaceExtension } from './lib/format'
import { processImage } from './lib/workerClient'

type Status = 'idle' | 'working' | 'done' | 'error'

const QUALITY_DEBOUNCE_MS = 200

const file = signal<File | null>(null)
const quality = signal(75)
const status = signal<Status>('idle')
const errorMessage = signal('')
const resultUrl = signal('')
const resultExtension = signal('webp')
const outputSize = signal(0)
const sizeIsExact = signal(false)
const dimensions = signal({ width: 0, height: 0 })
const isDragging = signal(false)
const samples = signal<EstimateSample[]>([])

let activeJobId = ''
let debounceTimer: ReturnType<typeof setTimeout> | undefined

const savings = computed(() => {
  const current = file.value
  return current ? percentReduction(current.size, outputSize.value) : 0
})

const outputName = computed(() => {
  const current = file.value
  return current
    ? replaceExtension(current.name, resultExtension.value)
    : `output.${resultExtension.value}`
})

const sizeHint = computed(() => {
  if (outputSize.value === 0) {
    return status.value === 'working'
      ? 'Estimating size…'
      : 'Move the slider to estimate the output size'
  }
  if (sizeIsExact.value) {
    return `Output size: ${formatBytes(outputSize.value)}`
  }
  const refining = status.value === 'working' ? ' (refining…)' : ''
  return `Estimated size: ~${formatBytes(outputSize.value)}${refining}`
})

export function App() {
  const inputRef = useRef<HTMLInputElement>(null)

  function releaseResult() {
    if (resultUrl.value) {
      URL.revokeObjectURL(resultUrl.value)
      resultUrl.value = ''
    }
  }

  function refreshEstimate() {
    if (samples.value.length === 0) return
    outputSize.value = interpolate(samples.value, quality.value)
    sizeIsExact.value = false
  }

  async function runProcess(buildEstimate: boolean) {
    const source = file.value
    if (!source) return

    const buffer = await source.arrayBuffer()
    if (file.value !== source) return

    const { jobId, response } = processImage({
      fileBuffer: buffer,
      targetFormat: 'webp',
      quality: quality.value,
      buildEstimate,
    })

    activeJobId = jobId
    status.value = 'working'
    errorMessage.value = ''

    try {
      const result = await response
      if (jobId !== activeJobId) return

      if (result.samples) samples.value = result.samples

      releaseResult()
      resultUrl.value = URL.createObjectURL(
        new Blob([result.outputBuffer], { type: result.mimeType }),
      )
      resultExtension.value = result.extension
      outputSize.value = result.outputSize
      sizeIsExact.value = true
      dimensions.value = { width: result.width, height: result.height }
      status.value = 'done'
    } catch (error) {
      if (jobId !== activeJobId) return
      status.value = 'error'
      errorMessage.value =
        error instanceof Error ? error.message : 'Conversion failed'
    }
  }

  function load(source: File) {
    if (debounceTimer) clearTimeout(debounceTimer)
    releaseResult()
    file.value = source
    samples.value = []
    outputSize.value = 0
    sizeIsExact.value = false
    dimensions.value = { width: 0, height: 0 }
    errorMessage.value = ''
    status.value = 'working'
    void runProcess(true)
  }

  function scheduleProcess() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      void runProcess(false)
    }, QUALITY_DEBOUNCE_MS)
  }

  function pickFiles(files: FileList | null) {
    const next = files?.[0]
    if (next) load(next)
  }

  function onInputChange(event: JSX.TargetedEvent<HTMLInputElement, Event>) {
    pickFiles(event.currentTarget.files)
  }

  function onDrop(event: JSX.TargetedDragEvent<HTMLButtonElement>) {
    event.preventDefault()
    isDragging.value = false
    pickFiles(event.dataTransfer?.files ?? null)
  }

  function onDragOver(event: JSX.TargetedDragEvent<HTMLButtonElement>) {
    event.preventDefault()
    isDragging.value = true
  }

  const current = file.value

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
        <span class="dropzone__title">Drop an image here</span>
        <span class="dropzone__hint">
          or click to choose a file (JPEG, PNG, WebP)
        </span>
      </button>

      <input
        ref={inputRef}
        class="visually-hidden"
        type="file"
        accept="image/*"
        onChange={onInputChange}
      />

      {current && (
        <section class="panel">
          <div class="panel__row">
            <span class="panel__label">File</span>
            <span class="panel__value" title={current.name}>
              {current.name}
            </span>
          </div>
          <div class="panel__row">
            <span class="panel__label">Original size</span>
            <span class="panel__value">{formatBytes(current.size)}</span>
          </div>

          <label class="field">
            <span class="field__label">Quality: {quality.value}</span>
            <input
              type="range"
              min={1}
              max={100}
              value={quality.value}
              onInput={(event) => {
                quality.value = Number(event.currentTarget.value)
                refreshEstimate()
                scheduleProcess()
              }}
            />
            <span class="field__hint" aria-live="polite">
              {sizeHint.value}
            </span>
          </label>
        </section>
      )}

      {status.value === 'error' && (
        <p class="message message--error" role="alert">
          {errorMessage.value}
        </p>
      )}

      {resultUrl.value && current && (
        <section class="result">
          <img
            class="result__preview"
            src={resultUrl.value}
            alt="Converted preview"
          />
          <div class="result__meta">
            <div class="panel__row">
              <span class="panel__label">
                {sizeIsExact.value ? 'Output size' : 'Estimated size'}
              </span>
              <span class="panel__value">
                {sizeIsExact.value ? '' : '~'}
                {formatBytes(outputSize.value)}
              </span>
            </div>
            <div class="panel__row">
              <span class="panel__label">Dimensions</span>
              <span class="panel__value">
                {dimensions.value.width} × {dimensions.value.height}
              </span>
            </div>
            <div class="panel__row">
              <span class="panel__label">Size change</span>
              <span
                class={`panel__value${savings.value >= 0 ? ' panel__value--good' : ' panel__value--bad'}`}
              >
                {savings.value >= 0
                  ? `−${savings.value}%`
                  : `+${Math.abs(savings.value)}%`}
              </span>
            </div>
            <a
              class="button button--primary"
              href={resultUrl.value}
              download={outputName.value}
            >
              Download WebP
            </a>
          </div>
        </section>
      )}
    </main>
  )
}
