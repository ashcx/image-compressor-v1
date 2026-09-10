import type { OutputFormat } from './types'

export type ControlKey = 'quality' | 'effort' | 'speed'

export interface FormatControl {
  key: ControlKey
  label: string
  min: number
  max: number
  step: number
  default: number
  hint?: string
}

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
  'jxl',
]

export const FORMAT_SPECS: Record<OutputFormat, FormatSpec> = {
  jpeg: {
    format: 'jpeg',
    label: 'JPEG',
    mimeType: 'image/jpeg',
    extension: 'jpg',
    lossless: false,
    controls: [
      {
        key: 'quality',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 1,
        default: 75,
      },
    ],
  },
  png: {
    format: 'png',
    label: 'PNG',
    mimeType: 'image/png',
    extension: 'png',
    lossless: true,
    controls: [
      {
        key: 'effort',
        label: 'Optimisation',
        min: 0,
        max: 6,
        step: 1,
        default: 2,
        hint: 'oxipng level — higher is smaller but slower',
      },
    ],
  },
  webp: {
    format: 'webp',
    label: 'WebP',
    mimeType: 'image/webp',
    extension: 'webp',
    lossless: false,
    controls: [
      {
        key: 'quality',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 1,
        default: 75,
      },
    ],
  },
  avif: {
    format: 'avif',
    label: 'AVIF',
    mimeType: 'image/avif',
    extension: 'avif',
    lossless: false,
    controls: [
      {
        key: 'quality',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 1,
        default: 50,
      },
      {
        key: 'speed',
        label: 'Speed',
        min: 0,
        max: 10,
        step: 1,
        default: 6,
        hint: 'lower is smaller but slower',
      },
    ],
  },
  jxl: {
    format: 'jxl',
    label: 'JPEG XL',
    mimeType: 'image/jxl',
    extension: 'jxl',
    lossless: false,
    controls: [
      {
        key: 'quality',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 1,
        default: 75,
      },
      { key: 'effort', label: 'Effort', min: 1, max: 9, step: 1, default: 7 },
    ],
  },
}

export function formatSpec(format: OutputFormat): FormatSpec {
  return FORMAT_SPECS[format]
}
