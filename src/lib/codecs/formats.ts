import type { OutputFormat } from './types'

export type ControlKey = 'quality' | 'effort' | 'speed' | 'mode'

interface ControlBase {
  key: ControlKey
  label: string
  hint?: string
}

export interface RangeControl extends ControlBase {
  kind: 'range'
  min: number
  max: number
  step: number
  default: number
}

export interface SelectOption {
  label: string
  value: number
  hint?: string
}

export interface SelectControl extends ControlBase {
  kind: 'select'
  options: SelectOption[]
  default: number
}

export type FormatControl = RangeControl | SelectControl

export interface FormatSpec {
  format: OutputFormat
  label: string
  mimeType: string
  extension: string
  lossless: boolean
  controls: FormatControl[]
}

export const FORMAT_ORDER: OutputFormat[] = [
  'jpeg',
  'png',
  'webp',
  'avif',
  'heic',
]

const QUALITY_PRESETS: SelectControl = {
  kind: 'select',
  key: 'quality',
  label: 'Quality',
  options: [
    {
      label: 'Best',
      value: 94,
      hint: 'Largest file. Very high quality is often redundant for photos — big files with little perceivable gain.',
    },
    { label: 'Better', value: 85 },
    { label: 'Default', value: 75 },
    { label: 'Low', value: 50, hint: 'Smallest file, visible trade-off.' },
  ],
  default: 75,
}

export const FORMAT_SPECS: Record<OutputFormat, FormatSpec> = {
  jpeg: {
    format: 'jpeg',
    label: 'JPEG',
    mimeType: 'image/jpeg',
    extension: 'jpg',
    lossless: false,
    controls: [QUALITY_PRESETS],
  },
  png: {
    format: 'png',
    label: 'PNG',
    mimeType: 'image/png',
    extension: 'png',
    lossless: true,
    controls: [
      {
        kind: 'select',
        key: 'mode',
        label: 'Compression',
        default: 0,
        options: [
          {
            label: 'Uncompressed',
            value: 0,
            hint: 'Fastest. Native PNG, lossless.',
          },
          {
            label: 'Lossless Compressed (slow)',
            value: 1,
            hint: 'Slow to process, but fully lossless (30–50% smaller).',
          },
          {
            label: 'Compressed (best for graphics, slowest)',
            value: 2,
            hint: 'Slow. Not recommended for photos — use JPEG for those. Can be acceptable for graphics with solid colours.',
          },
        ],
      },
    ],
  },
  webp: {
    format: 'webp',
    label: 'WebP',
    mimeType: 'image/webp',
    extension: 'webp',
    lossless: false,
    controls: [QUALITY_PRESETS],
  },
  avif: {
    format: 'avif',
    label: 'AVIF (slower)',
    mimeType: 'image/avif',
    extension: 'avif',
    lossless: false,
    controls: [
      {
        kind: 'range',
        key: 'quality',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 1,
        default: 50,
      },
      {
        kind: 'select',
        key: 'speed',
        label: 'Speed',
        default: 10,
        hint: 'Slower speeds compress more but take much longer.',
        options: [
          { label: 'Default', value: 10 },
          { label: 'Slow (slightly smaller size)', value: 8 },
          { label: 'Slowest (smallest size)', value: 6 },
        ],
      },
    ],
  },
  heic: {
    format: 'heic',
    label: 'HEIC (slower)',
    mimeType: 'image/heic',
    extension: 'heic',
    lossless: false,
    // The bundled libheif/kvazaar encoder exposes a single fixed quality, so
    // HEIC has no adjustable controls yet.
    controls: [],
  },
}

export const SUPPORTED_FORMAT_LABELS = FORMAT_ORDER.map((format) =>
  FORMAT_SPECS[format].mimeType.replace(/^image\//, '').toUpperCase(),
)

export function listFormatLabels(
  labels: string[] = SUPPORTED_FORMAT_LABELS,
): string {
  if (labels.length < 2) return labels[0] ?? ''
  if (labels.length === 2) return labels.join(' and ')
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`
}

/**
 * Heavy codecs keep a large WASM heap and decoded canvas per worker, so they
 * run on a reduced (halved) worker pool. AVIF always qualifies; PNG qualifies
 * for both compressed modes (oxipng lossless and quantised lossy) but not the
 * native uncompressed path.
 */
export function isHeavyFormat(format: OutputFormat, mode: number): boolean {
  if (format === 'avif') return true
  if (format === 'heic') return true
  if (format === 'png') return mode >= 1
  return false
}
