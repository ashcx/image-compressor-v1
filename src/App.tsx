import { computed, signal } from '@preact/signals'
import type { JSX } from 'preact'
import { useRef } from 'preact/hooks'
import { convertToWebp } from './lib/convert'
import { formatBytes, percentReduction, replaceExtension } from './lib/format'

type Status = 'idle' | 'working' | 'done' | 'error'

const file = signal<File | null>(null)
const quality = signal(75)
const status = signal<Status>('idle')
const errorMessage = signal('')
const resultUrl = signal('')
const outputSize = signal(0)
const dimensions = signal({ width: 0, height: 0 })
const isDragging = signal(false)

const savings = computed(() => {
  const current = file.value
  return current ? percentReduction(current.size, outputSize.value) : 0
})

const outputName = computed(() => {
  const current = file.value
  return current ? replaceExtension(current.name, 'webp') : 'output.webp'
})

export function App() {
  const inputRef = useRef<HTMLInputElement>(null)

  async function convert(source: File) {
    if (resultUrl.value) {
      URL.revokeObjectURL(resultUrl.value)
      resultUrl.value = ''
    }

    file.value = source
    outputSize.value = 0
    errorMessage.value = ''
    status.value = 'working'

    try {
      const result = await convertToWebp(source, quality.value)
      resultUrl.value = URL.createObjectURL(result.blob)
      outputSize.value = result.blob.size
      dimensions.value = { width: result.width, height: result.height }
      status.value = 'done'
    } catch (error) {
      status.value = 'error'
      errorMessage.value =
        error instanceof Error ? error.message : 'Conversion failed'
    }
  }

  function pickFiles(files: FileList | null) {
    const next = files?.[0]
    if (next) void convert(next)
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
            <span class="panel__label">Original</span>
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
              }}
            />
          </label>

          <button
            type="button"
            class="button"
            disabled={status.value === 'working'}
            onClick={() => {
              if (current) void convert(current)
            }}
          >
            {status.value === 'working' ? 'Converting…' : 'Encode to WebP'}
          </button>
        </section>
      )}

      {status.value === 'error' && (
        <p class="message message--error" role="alert">
          {errorMessage.value}
        </p>
      )}

      {status.value === 'done' && current && (
        <section class="result">
          <img
            class="result__preview"
            src={resultUrl.value}
            alt="Converted preview"
          />
          <div class="result__meta">
            <div class="panel__row">
              <span class="panel__label">Output</span>
              <span class="panel__value">{formatBytes(outputSize.value)}</span>
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
