interface WorkerResult {
  type: 'result'
  backend: 'native' | 'wasm'
  method?: number
  elapsedMs: number
  encodeMs?: number
  readbackMs?: number
  bytes: number
  outputBlob: Blob
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

interface MemorySnapshot {
  usedBytes: number
  totalBytes: number
  limitBytes: number
}

interface BatchInput {
  name: string
  url: string
}

interface QualityMetrics {
  ssim: number
  psnrDb: number
}

interface MeasuredRow {
  elapsedMs: number
  bytes: number
  encodeMs?: number
  readbackMs?: number
  quality?: QualityMetrics
  memoryBefore: MemorySnapshot | null
  memoryAfter: MemorySnapshot | null
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

function roundMetric(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  )
  return sorted[index]
}

function memorySnapshot(): MemorySnapshot | null {
  const memory = (
    performance as Performance & {
      memory?: {
        usedJSHeapSize: number
        totalJSHeapSize: number
        jsHeapSizeLimit: number
      }
    }
  ).memory
  if (!memory) return null
  return {
    usedBytes: memory.usedJSHeapSize,
    totalBytes: memory.totalJSHeapSize,
    limitBytes: memory.jsHeapSizeLimit,
  }
}

async function requestMeasured<T extends WorkerResponse>(
  worker: Worker,
  message: object,
  transfer: Transferable[] = [],
): Promise<{
  result: T
  before: MemorySnapshot | null
  after: MemorySnapshot | null
}> {
  const before = memorySnapshot()
  const result = await request<T>(worker, message, transfer)
  return { result, before, after: memorySnapshot() }
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

function clonePixels(imageData: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  )
}

async function createMetricReference(
  imageData: ImageData,
  maxEdge: number,
): Promise<ImageData> {
  const scale = Math.min(
    1,
    maxEdge / Math.max(imageData.width, imageData.height),
  )
  const width = Math.max(1, Math.round(imageData.width * scale))
  const height = Math.max(1, Math.round(imageData.height * scale))
  const sourceCanvas = new OffscreenCanvas(imageData.width, imageData.height)
  const sourceContext = sourceCanvas.getContext('2d')
  const targetCanvas = new OffscreenCanvas(width, height)
  const targetContext = targetCanvas.getContext('2d')
  if (!sourceContext || !targetContext) {
    throw new Error('Quality metric canvas is unavailable')
  }
  sourceContext.putImageData(imageData, 0, 0)
  targetContext.drawImage(sourceCanvas, 0, 0, width, height)
  return targetContext.getImageData(0, 0, width, height)
}

function comparePixels(
  reference: ImageData,
  output: ImageData,
): QualityMetrics {
  const referenceData = reference.data
  const outputData = output.data
  let mse = 0
  let ssim = 0
  let windows = 0
  const c1 = (0.01 * 255) ** 2
  const c2 = (0.03 * 255) ** 2
  const windowSize = 8

  for (let y = 0; y < reference.height; y += windowSize) {
    for (let x = 0; x < reference.width; x += windowSize) {
      let count = 0
      let referenceSum = 0
      let outputSum = 0
      let referenceSquareSum = 0
      let outputSquareSum = 0
      let productSum = 0
      for (
        let windowY = y;
        windowY < Math.min(y + windowSize, reference.height);
        windowY += 1
      ) {
        for (
          let windowX = x;
          windowX < Math.min(x + windowSize, reference.width);
          windowX += 1
        ) {
          const offset = (windowY * reference.width + windowX) * 4
          const referenceRed = referenceData[offset]
          const referenceGreen = referenceData[offset + 1]
          const referenceBlue = referenceData[offset + 2]
          const outputRed = outputData[offset]
          const outputGreen = outputData[offset + 1]
          const outputBlue = outputData[offset + 2]
          const referenceLuma =
            0.2126 * referenceRed +
            0.7152 * referenceGreen +
            0.0722 * referenceBlue
          const outputLuma =
            0.2126 * outputRed + 0.7152 * outputGreen + 0.0722 * outputBlue
          const redDelta = referenceRed - outputRed
          const greenDelta = referenceGreen - outputGreen
          const blueDelta = referenceBlue - outputBlue
          mse +=
            (redDelta * redDelta +
              greenDelta * greenDelta +
              blueDelta * blueDelta) /
            3
          referenceSum += referenceLuma
          outputSum += outputLuma
          referenceSquareSum += referenceLuma * referenceLuma
          outputSquareSum += outputLuma * outputLuma
          productSum += referenceLuma * outputLuma
          count += 1
        }
      }
      const referenceMean = referenceSum / count
      const outputMean = outputSum / count
      const referenceVariance = referenceSquareSum / count - referenceMean ** 2
      const outputVariance = outputSquareSum / count - outputMean ** 2
      const covariance = productSum / count - referenceMean * outputMean
      ssim +=
        ((2 * referenceMean * outputMean + c1) * (2 * covariance + c2)) /
        ((referenceMean ** 2 + outputMean ** 2 + c1) *
          (referenceVariance + outputVariance + c2))
      windows += 1
    }
  }

  const psnrMse = mse / (reference.width * reference.height)
  return {
    ssim: ssim / windows,
    psnrDb:
      psnrMse === 0
        ? Number.POSITIVE_INFINITY
        : 10 * Math.log10((255 * 255) / psnrMse),
  }
}

async function measureQuality(
  reference: ImageData,
  outputBlob: Blob,
): Promise<QualityMetrics> {
  const bitmap = await createImageBitmap(outputBlob)
  const canvas = new OffscreenCanvas(reference.width, reference.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Quality output canvas is unavailable')
  context.drawImage(bitmap, 0, 0, reference.width, reference.height)
  bitmap.close()
  return comparePixels(
    reference,
    context.getImageData(0, 0, reference.width, reference.height),
  )
}

async function createWorker(imageData: ImageData) {
  const worker = new Worker(
    new URL('./webp-compare.worker.ts', import.meta.url),
    { type: 'module' },
  )
  const ready = await initWorker(worker, imageData)
  return { worker, ready }
}

async function initWorker(worker: Worker, imageData: ImageData) {
  return request<ReadyResult>(worker, { type: 'init', imageData }, [
    imageData.data.buffer,
  ])
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

function summarizeRows(rows: MeasuredRow[]) {
  const elapsed = rows.map((row) => row.elapsedMs)
  const bytes = rows.map((row) => row.bytes)
  const encode = rows
    .map((row) => row.encodeMs)
    .filter((value): value is number => value !== undefined)
  const readback = rows
    .map((row) => row.readbackMs)
    .filter((value): value is number => value !== undefined)
  const memoryDeltas = rows.flatMap((row) => {
    if (!row.memoryBefore || !row.memoryAfter) return []
    return [row.memoryAfter.usedBytes - row.memoryBefore.usedBytes]
  })
  const memoryAfter = rows
    .map((row) => row.memoryAfter?.usedBytes)
    .filter((value): value is number => value !== undefined)
  const ssim = rows
    .map((row) => row.quality?.ssim)
    .filter((value): value is number => value !== undefined)
  const psnr = rows
    .map((row) => row.quality?.psnrDb)
    .filter((value): value is number => value !== undefined)

  return {
    count: rows.length,
    totalMs: round(elapsed.reduce((sum, value) => sum + value, 0)),
    averageMs: round(
      elapsed.reduce((sum, value) => sum + value, 0) / rows.length,
    ),
    medianMs: round(median(elapsed)),
    p95Ms: round(percentile(elapsed, 0.95)),
    minMs: round(Math.min(...elapsed)),
    maxMs: round(Math.max(...elapsed)),
    totalBytes: bytes.reduce((sum, value) => sum + value, 0),
    averageBytes: round(
      bytes.reduce((sum, value) => sum + value, 0) / rows.length,
    ),
    medianBytes: round(median(bytes)),
    p95Bytes: round(percentile(bytes, 0.95)),
    minBytes: Math.min(...bytes),
    maxBytes: Math.max(...bytes),
    ...(encode.length > 0
      ? {
          medianEncodeMs: round(median(encode)),
          p95EncodeMs: round(percentile(encode, 0.95)),
          medianReadbackMs: round(median(readback)),
          p95ReadbackMs: round(percentile(readback, 0.95)),
        }
      : {}),
    ...(memoryDeltas.length > 0
      ? {
          medianHeapDeltaBytes: round(median(memoryDeltas)),
          peakHeapDeltaBytes: Math.max(...memoryDeltas),
          peakHeapAfterBytes: Math.max(...memoryAfter),
        }
      : {}),
    ...(ssim.length > 0 && psnr.length > 0
      ? {
          quality: {
            meanSsim: roundMetric(
              ssim.reduce((sum, value) => sum + value, 0) / ssim.length,
              4,
            ),
            medianSsim: roundMetric(median(ssim), 4),
            minSsim: roundMetric(Math.min(...ssim), 4),
            meanPsnrDb: roundMetric(
              psnr.reduce((sum, value) => sum + value, 0) / psnr.length,
              3,
            ),
            medianPsnrDb: roundMetric(median(psnr), 3),
            minPsnrDb: roundMetric(Math.min(...psnr), 3),
          },
        }
      : {}),
  }
}

/**
 * Runs one native encode and the selected WASM methods for every input while
 * reusing the same pair of workers. Unlike run(), this measures one
 * representative encode per image so a large corpus is practical without
 * hiding image mix.
 */
export async function runBatch(
  inputs: BatchInput[],
  quality: number,
  methods: number[],
  measureQualityMetrics = false,
  metricEdge = 1024,
) {
  if (inputs.length === 0) throw new Error('Batch has no inputs')
  const selectedMethods = [...new Set(methods)].sort((a, b) => a - b)
  if (
    selectedMethods.length === 0 ||
    selectedMethods.some(
      (method) => !Number.isInteger(method) || method < 0 || method > 6,
    )
  ) {
    throw new Error('WASM methods must be integers from 0 through 6')
  }

  const nativeFirst = await createPixels(inputs[0].url)
  let referencePixels = measureQualityMetrics
    ? await createMetricReference(nativeFirst, metricEdge)
    : null
  const wasmFirst = clonePixels(nativeFirst)
  const native = await createWorker(nativeFirst)
  const wasm = await createWorker(wasmFirst)
  const nativeRows: MeasuredRow[] = []
  const wasmRows = new Map<number, MeasuredRow[]>()
  for (const method of selectedMethods) wasmRows.set(method, [])
  const dimensions: Array<{ width: number; height: number }> = []
  const memorySamples: MemorySnapshot[] = []
  const sampleMemory = () => {
    const snapshot = memorySnapshot()
    if (snapshot) memorySamples.push(snapshot)
  }
  sampleMemory()
  const sampler = setInterval(sampleMemory, 25)

  try {
    let width = native.ready.width
    let height = native.ready.height
    for (let index = 0; index < inputs.length; index += 1) {
      if (index > 0) {
        const nativePixels = await createPixels(inputs[index].url)
        referencePixels = measureQualityMetrics
          ? await createMetricReference(nativePixels, metricEdge)
          : null
        const wasmPixels = clonePixels(nativePixels)
        const nativeReady = await initWorker(native.worker, nativePixels)
        await initWorker(wasm.worker, wasmPixels)
        width = nativeReady.width
        height = nativeReady.height
      }
      dimensions.push({ width, height })

      const nativeResult = await requestMeasured<WorkerResult>(native.worker, {
        type: 'encode',
        backend: 'native',
        quality,
      })
      nativeRows.push({
        elapsedMs: nativeResult.result.elapsedMs,
        bytes: nativeResult.result.bytes,
        quality: referencePixels
          ? await measureQuality(
              referencePixels,
              nativeResult.result.outputBlob,
            )
          : undefined,
        memoryBefore: nativeResult.before,
        memoryAfter: nativeResult.after,
      })

      for (const method of selectedMethods) {
        const wasmResult = await requestMeasured<WorkerResult>(wasm.worker, {
          type: 'encode',
          backend: 'wasm',
          quality,
          method,
        })
        const methodRows = wasmRows.get(method)
        if (!methodRows) throw new Error(`Missing WASM method ${method}`)
        methodRows.push({
          elapsedMs: wasmResult.result.elapsedMs,
          encodeMs: wasmResult.result.encodeMs,
          readbackMs: wasmResult.result.readbackMs,
          bytes: wasmResult.result.bytes,
          quality: referencePixels
            ? await measureQuality(
                referencePixels,
                wasmResult.result.outputBlob,
              )
            : undefined,
          memoryBefore: wasmResult.before,
          memoryAfter: wasmResult.after,
        })
      }
    }

    sampleMemory()
    const nativeSummary = summarizeRows(nativeRows)
    const nativeMedian = nativeSummary.medianMs
    const wasmSummary = Object.fromEntries(
      selectedMethods.map((method) => {
        const methodRows = wasmRows.get(method)
        if (!methodRows) throw new Error(`Missing WASM method ${method}`)
        const summary = summarizeRows(methodRows)
        return [
          `method${method}`,
          {
            ...summary,
            timeRatioVsNative: round(summary.medianMs / nativeMedian),
            sizeRatioVsNative: round(
              summary.averageBytes / nativeSummary.averageBytes,
            ),
          },
        ]
      }),
    )
    const peakHeap = memorySamples.length
      ? Math.max(...memorySamples.map((sample) => sample.usedBytes))
      : null
    const firstMemory = memorySamples[0] ?? null
    const lastMemory = memorySamples[memorySamples.length - 1] ?? null

    return {
      files: inputs.length,
      width,
      height,
      dimensions: {
        first: dimensions[0],
        last: dimensions[dimensions.length - 1],
        minMegapixels: round(
          Math.min(
            ...dimensions.map(({ width, height }) => (width * height) / 1e6),
          ),
        ),
        maxMegapixels: round(
          Math.max(
            ...dimensions.map(({ width, height }) => (width * height) / 1e6),
          ),
        ),
        averageMegapixels: round(
          dimensions.reduce(
            (sum, { width, height }) => sum + (width * height) / 1e6,
            0,
          ) / dimensions.length,
        ),
      },
      quality,
      methods: selectedMethods,
      qualityMetrics: measureQualityMetrics
        ? {
            maxEdge: metricEdge,
            comparison: 'RGB PSNR and 8x8-window luma SSIM',
          }
        : null,
      native: {
        ...nativeSummary,
        coldMs: round(nativeRows[0].elapsedMs),
      },
      wasm: wasmSummary,
      memory: {
        source: 'Chromium performance.memory; JS heap only',
        sampleCount: memorySamples.length,
        startUsedBytes: firstMemory?.usedBytes ?? null,
        endUsedBytes: lastMemory?.usedBytes ?? null,
        peakUsedBytes: peakHeap,
        peakUsedMiB: peakHeap === null ? null : round(peakHeap / 1024 / 1024),
        limitBytes: lastMemory?.limitBytes ?? null,
      },
      notes: [
        'Each image is decoded once for each benchmark worker and encoded once per backend/method.',
        'Batch totals are sequential codec work, not wall-clock time for a concurrent application worker pool.',
        'Native timing measures OffscreenCanvas.convertToBlob in a worker.',
        'WASM elapsedMs includes canvas pixel readback plus libwebp encode; encodeMs excludes readback.',
        'Memory is the page-visible JS heap. Native canvas surfaces and WASM linear memory are not fully exposed by performance.memory.',
      ],
    }
  } finally {
    clearInterval(sampler)
    native.worker.terminate()
    wasm.worker.terminate()
  }
}
