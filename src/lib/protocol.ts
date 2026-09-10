import type { OutputFormat } from './codecs/types'
import type { EstimateSample } from './estimate'

export interface ProcessRequest {
  type: 'process'
  jobId: string
  fileBuffer: ArrayBuffer
  targetFormat: OutputFormat
  quality?: number
  buildEstimate?: boolean
}

export type WorkerRequest = ProcessRequest

export interface ResultResponse {
  type: 'result'
  jobId: string
  outputBuffer: ArrayBuffer
  outputSize: number
  width: number
  height: number
  format: OutputFormat
  extension: string
  mimeType: string
  samples?: EstimateSample[]
}

export interface ErrorResponse {
  type: 'error'
  jobId: string
  error: string
}

export type WorkerResponse = ResultResponse | ErrorResponse
