interface WorkerResult {
  type: 'result'
  backend: 'native' | 'wasm'
  method?: number
  elapsedMs: number
  encodeMs?: number
  readbackMs?: number
  bytes: number
}

interface ReadyResult {
  type: 'ready'
  width: number
  height: number
}

interface ErrorResult {
  type: 'error'
  message: string
}

type WorkerResponse = WorkerResult | ReadyResult | ErrorResult

function request<T extends WorkerResponse>(
  worker: Worker,
  message: object,
  transfer: Transferable[] = [],
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      if (event.data.type === 'error') reject(new Error(event.data.message))
      else resolve(event.data as T)
    }
    const onError = (event: ErrorEvent) => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      reject(new Error(event.message || 'WebP benchmark worker failed'))
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError, { once: true })
    worker.postMessage(message, transfer)
  })
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

async function createPixels(inputUrl: string) {
  const response = await fetch(inputUrl)
  if (!response.ok) {
    throw new Error(`Could not load benchmark input: ${response.status}`)
  }
  const bitmap = await createImageBitmap(await response.blob())
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Benchmark canvas context is unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

async function createWorker(imageData: ImageData) {
  const worker = new Worker(
    new URL('./webp-compare.worker.ts', import.meta.url),
    { type: 'module' },
  )
  const ready = await request<ReadyResult>(
    worker,
    { type: 'init', imageData },
    [imageData.data.buffer],
  )
  return { worker, ready }
}

export async function run(inputUrl: string, quality: number, repeats: number) {
  if (!Number.isInteger(repeats) || repeats < 2) {
    throw new Error('Repeats must be an integer greater than one')
  }

  const firstPixels = await createPixels(inputUrl)
  const secondPixels = await createPixels(inputUrl)
  const native = await createWorker(firstPixels)
  const wasm = await createWorker(secondPixels)

  try {
    const nativeCold = await request<WorkerResult>(native.worker, {
      type: 'encode',
      backend: 'native',
      quality,
    })
    const nativeRows: WorkerResult[] = []
    for (let index = 0; index < repeats; index += 1) {
      nativeRows.push(
        await request<WorkerResult>(native.worker, {
          type: 'encode',
          backend: 'native',
          quality,
        }),
      )
    }

    const wasmCold = await request<WorkerResult>(wasm.worker, {
      type: 'encode',
      backend: 'wasm',
      quality,
      method: 0,
    })
    const wasmRows: Array<{ method: number; rows: WorkerResult[] }> = []
    for (let method = 0; method <= 6; method += 1) {
      await request<WorkerResult>(wasm.worker, {
        type: 'encode',
        backend: 'wasm',
        quality,
        method,
      })
      const rows: WorkerResult[] = []
      for (let index = 0; index < repeats; index += 1) {
        rows.push(
          await request<WorkerResult>(wasm.worker, {
            type: 'encode',
            backend: 'wasm',
            quality,
            method,
          }),
        )
      }
      wasmRows.push({ method, rows })
    }

    const nativeWarmMs = nativeRows.map((row) => row.elapsedMs)
    const wasmMethods = wasmRows.map(({ method, rows }) => ({
      method,
      medianMs: round(median(rows.map((row) => row.elapsedMs))),
      minMs: round(Math.min(...rows.map((row) => row.elapsedMs))),
      medianEncodeMs: round(median(rows.map((row) => row.encodeMs ?? 0))),
      medianReadbackMs: round(median(rows.map((row) => row.readbackMs ?? 0))),
      bytes: rows[rows.length - 1].bytes,
    }))
    const fastestWasm = wasmMethods.reduce((best, row) =>
      row.medianMs < best.medianMs ? row : best,
    )

    return {
      width: native.ready.width,
      height: native.ready.height,
      megapixels: round((native.ready.width * native.ready.height) / 1e6),
      quality,
      repeats,
      native: {
        coldMs: round(nativeCold.elapsedMs),
        medianMs: round(median(nativeWarmMs)),
        minMs: round(Math.min(...nativeWarmMs)),
        bytes: nativeRows[nativeRows.length - 1].bytes,
      },
      wasm: {
        coldMs: round(wasmCold.elapsedMs),
        methods: wasmMethods,
        fastest: fastestWasm,
      },
      notes: [
        'Native timing measures OffscreenCanvas.convertToBlob in a worker.',
        'WASM medianMs includes canvas pixel readback plus libwebp encode; medianEncodeMs excludes readback.',
        'WASM coldMs includes first-call module and WebAssembly initialization.',
      ],
    }
  } finally {
    native.worker.terminate()
    wasm.worker.terminate()
  }
}
