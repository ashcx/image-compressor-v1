import { detectFormat } from './detect'

/** Bytes read to sniff the format. Covers every magic-byte offset we parse. */
export const HEADER_BYTES = 64 * 1024
export const VALIDATION_CONCURRENCY = 8

const SUPPORTED = 'JPEG, PNG, WebP, or AVIF'

export interface IntakeAcceptance {
  accepted: boolean
  reason?: string
}

export interface IntakeRejection {
  name: string
  reason: string
}

export interface IntakeOutcome {
  accepted: File[]
  rejected: IntakeRejection[]
}

/**
 * Checks a file's magic bytes using a bounded header read so unsupported files
 * are rejected before they enter the processing queue. The extension is
 * deliberately ignored; renamed files still route by content.
 */
export async function validateImageFile(file: File): Promise<IntakeAcceptance> {
  if (file.size === 0) return { accepted: false, reason: 'Empty file' }

  let header: ArrayBuffer
  try {
    header = await file
      .slice(0, Math.min(file.size, HEADER_BYTES))
      .arrayBuffer()
  } catch {
    return { accepted: false, reason: 'Could not read the file' }
  }

  if (!detectFormat(header)) {
    return {
      accepted: false,
      reason: `Unsupported format (expected ${SUPPORTED})`,
    }
  }
  return { accepted: true }
}

/**
 * Validates a batch with bounded concurrency while preserving input order, so
 * a 1,000-file drop does not open 1,000 concurrent reads or reorder the queue.
 */
export async function validateFiles(
  files: File[],
  concurrency = VALIDATION_CONCURRENCY,
): Promise<IntakeOutcome> {
  if (files.length === 0) return { accepted: [], rejected: [] }

  const results = new Array<IntakeAcceptance | undefined>(files.length)
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), files.length) },
    async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= files.length) return
        results[index] = await validateImageFile(files[index])
      }
    },
  )
  await Promise.all(workers)

  const accepted: File[] = []
  const rejected: IntakeRejection[] = []
  files.forEach((file, index) => {
    const result = results[index]
    if (result?.accepted) accepted.push(file)
    else {
      rejected.push({
        name: file.name,
        reason: result?.reason ?? 'Unsupported file',
      })
    }
  })
  return { accepted, rejected }
}
