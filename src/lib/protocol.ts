import type { OutputFormat, ResizeOptions } from './codecs/types'
import type { EstimateSample } from './estimate'

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
}

export type WorkerRequest = ProcessRequest

export interface ResultResponse {
  type: 'result'
  jobId: string
  outputBlob: Blob
  thumbnailBlob: Blob
  outputSize: number
  width: number
  height: number
  format: OutputFormat
  extension: string
  mimeType: string
}

export interface EstimateResponse {
  type: 'estimate'
  jobId: string
  width: number
  height: number
  samples: EstimateSample[]
  thumbnailBlob: Blob
}

export interface ErrorResponse {
  type: 'error'
  jobId: string
  error: string
}

export type WorkerResponse = ResultResponse | EstimateResponse | ErrorResponse
