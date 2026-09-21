import { encode as encodeWebp } from '@jsquash/webp'

interface EncodeRequest {
  type: 'encode'
  backend: 'native' | 'wasm'
  quality: number
  method?: number
}

interface InitRequest {
  type: 'init'
  imageData: ImageData
}

type Request = InitRequest | EncodeRequest

interface ResultResponse {
  type: 'result'
  backend: 'native' | 'wasm'
  method?: number
  elapsedMs: number
  encodeMs?: number
  readbackMs?: number
  bytes: number
  outputBlob: Blob
}

interface ReadyResponse {
  type: 'ready'
  width: number
  height: number
}

interface ErrorResponse {
  type: 'error'
  message: string
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null
  postMessage(message: ReadyResponse | ResultResponse | ErrorResponse): void
}

let nativeCanvas: OffscreenCanvas | null = null
let nativeContext: OffscreenCanvasRenderingContext2D | null = null
let wasmCanvas: OffscreenCanvas | null = null
let wasmContext: OffscreenCanvasRenderingContext2D | null = null

scope.onmessage = async (event) => {
  try {
    const request = event.data
    if (request.type === 'init') {
      const { width, height } = request.imageData
      nativeCanvas = new OffscreenCanvas(width, height)
      nativeContext = nativeCanvas.getContext('2d')
      wasmCanvas = new OffscreenCanvas(width, height)
      wasmContext = wasmCanvas.getContext('2d', { willReadFrequently: true })
      if (!nativeContext || !wasmContext) {
        throw new Error('Worker canvas context is unavailable')
      }
      nativeContext.putImageData(request.imageData, 0, 0)
      wasmContext.putImageData(request.imageData, 0, 0)
      scope.postMessage({ type: 'ready', width, height })
      return
    }

    if (!nativeCanvas || !nativeContext || !wasmContext || !wasmCanvas) {
      throw new Error('Worker has not been initialized')
    }

    if (request.backend === 'native') {
      const started = performance.now()
      const blob = await nativeCanvas.convertToBlob({
        type: 'image/webp',
        quality: request.quality / 100,
      })
      if (blob.type !== 'image/webp') {
        throw new Error(
          `Native encoder returned ${blob.type || 'unknown MIME'}`,
        )
      }
      scope.postMessage({
        type: 'result',
        backend: 'native',
        elapsedMs: performance.now() - started,
        bytes: blob.size,
        outputBlob: blob,
      })
      return
    }

    const started = performance.now()
    const imageDataStarted = performance.now()
    const imageData = wasmContext.getImageData(
      0,
      0,
      wasmCanvas.width,
      wasmCanvas.height,
    )
    const readbackMs = performance.now() - imageDataStarted
    const encodedStarted = performance.now()
    const encoded = await encodeWebp(imageData, {
      quality: request.quality,
      method: request.method ?? 4,
    })
    scope.postMessage({
      type: 'result',
      backend: 'wasm',
      method: request.method ?? 4,
      elapsedMs: performance.now() - started,
      encodeMs: performance.now() - encodedStarted,
      readbackMs,
      bytes: encoded.byteLength,
      outputBlob: new Blob([encoded], { type: 'image/webp' }),
    })
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'WebP benchmark failed',
    })
  }
}
