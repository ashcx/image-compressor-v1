import type { OutputFormat, ResizeOptions } from './codecs/types'
import type { EstimateSample } from './estimate'

export interface ProcessLimits {
  maxSide?: number
  maxArea?: number
  maxPixels?: number
}

export interface ProcessRequest {
  type: 'process'
  jobId: string
  fileBuffer: ArrayBuffer
  targetFormat: OutputFormat
  quality?: number
  effort?: number
  speed?: number
  mode?: number
  resize?: ResizeOptions
  estimateOnly?: boolean
  /** Platform canvas ceilings plus the single-job pixel budget. */
  limits?: ProcessLimits
}

/**
 * Asks a worker to initialize the selected codec (native probe or WASM module
 * load/instantiate) with a tiny throwaway encode, so the first real compression
 * does not pay the module/WASM latency.
 */
export interface WarmRequest {
  type: 'warm'
  jobId: string
  targetFormat: OutputFormat
  quality?: number
  effort?: number
  speed?: number
  mode?: number
}

export type WorkerRequest = ProcessRequest | WarmRequest

export interface ResultResponse {
  type: 'result'
  jobId: string
  outputBlob: Blob
  outputSize: number
  width: number
  height: number
  format: OutputFormat
  extension: string
  mimeType: string
  /** True when the universal, platform, or budget ceiling forced a smaller decode. */
  capped: boolean
}

export interface EstimateResponse {
  type: 'estimate'
  jobId: string
  width: number
  height: number
  samples: EstimateSample[]
  /** True when the universal, platform, or budget ceiling forced a smaller decode. */
  capped: boolean
}

export interface ErrorResponse {
  type: 'error'
  jobId: string
  error: string
}

export interface WarmResponse {
  type: 'warm'
  jobId: string
}

export type WorkerResponse =
  | ResultResponse
  | EstimateResponse
  | WarmResponse
  | ErrorResponse
